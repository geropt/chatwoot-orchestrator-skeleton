import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../agent/agent.js";
import type { ChatwootClient } from "./client.js";
import type { Config } from "../config.js";
import type { HandoffExecutor } from "../handoff/executor.js";
import type { OffHoursIntakeExecutor } from "../handoff/off-hours-intake.js";
import { ConversationStore } from "../state/conversation-store.js";
import { DedupeStore } from "../state/dedupe-store.js";
import { handleWebhook, type WebhookDeps } from "./webhook.js";
import type { ChatwootWebhookPayload } from "./types.js";

const supportConfig: Config["support"] = {
  timezone: "America/Argentina/Buenos_Aires",
  businessHours: {
    monday: [{ start: "08:30", end: "17:00" }],
    tuesday: [{ start: "08:30", end: "17:00" }],
    wednesday: [{ start: "08:30", end: "17:00" }],
    thursday: [{ start: "08:30", end: "17:00" }],
    friday: [{ start: "08:30", end: "17:00" }]
  },
  holidays: [],
  emergencyPhone: "0800-999-0000"
};

function payload(content: string): ChatwootWebhookPayload {
  return {
    event: "message_created",
    id: "msg-1",
    content,
    message_type: "incoming",
    private: false,
    sender: { type: "contact", email: "user@example.com" },
    conversation: { id: 123, status: "pending", contact_inbox: { contact_id: 456 } }
  };
}

function makeDeps(overrides?: {
  agentRun?: Agent["run"];
  handoffExecute?: HandoffExecutor["execute"];
  offHoursExecute?: OffHoursIntakeExecutor["execute"];
}): WebhookDeps {
  return {
    chatwoot: {} as unknown as ChatwootClient,
    agent: {
      run: overrides?.agentRun ?? vi.fn()
    } as unknown as Agent,
    handoff: {
      execute: overrides?.handoffExecute ?? vi.fn()
    } as unknown as HandoffExecutor,
    offHoursIntake: {
      execute: overrides?.offHoursExecute ?? vi.fn()
    } as unknown as OffHoursIntakeExecutor,
    store: new ConversationStore(),
    dedupe: new DedupeStore(),
    config: {
      webhookSecret: "",
      skipSignatureVerification: true,
      maxTurns: 8,
      maxRetries: 2,
      support: supportConfig
    }
  };
}

describe("handleWebhook business hours policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the agent evaluate explicit human requests outside business hours", async () => {
    vi.setSystemTime(new Date("2026-04-28T01:00:00.000Z"));
    const handoffExecute = vi.fn();
    const offHoursExecute = vi.fn();
    const agentRun = vi.fn().mockResolvedValue({
      action: "handoff",
      text: "Dejo registrado tu pedido.",
      summary: "El usuario pidio operador fuera de horario.",
      priority: "medium"
    });
    const deps = makeDeps({ agentRun, handoffExecute, offHoursExecute });

    const result = await handleWebhook(deps, {
      rawBody: "{}",
      headers: { delivery: "delivery-1" },
      payload: payload("quiero hablar con un operador")
    });

    expect(result.action).toBe("off_hours:agent_decision");
    expect(agentRun).toHaveBeenCalledOnce();
    expect(handoffExecute).not.toHaveBeenCalled();
    expect(offHoursExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 123,
        reason: "agent_decision"
      })
    );
  });

  it("keeps the normal handoff for explicit human requests inside business hours", async () => {
    vi.setSystemTime(new Date("2026-04-27T13:00:00.000Z"));
    const handoffExecute = vi.fn();
    const offHoursExecute = vi.fn();
    const deps = makeDeps({ handoffExecute, offHoursExecute });

    const result = await handleWebhook(deps, {
      rawBody: "{}",
      headers: { delivery: "delivery-2" },
      payload: payload("quiero hablar con un operador")
    });

    expect(result.action).toBe("handoff:explicit_request");
    expect(handoffExecute).toHaveBeenCalledOnce();
    expect(offHoursExecute).not.toHaveBeenCalled();
  });

  it("routes emergencies outside business hours to the emergency message", async () => {
    vi.setSystemTime(new Date("2026-04-28T01:00:00.000Z"));
    const handoffExecute = vi.fn();
    const offHoursExecute = vi.fn();
    const agentRun = vi.fn().mockResolvedValue({
      action: "handoff",
      text: "Llamá a emergencias.",
      summary: "El usuario reporto un choque con una persona lesionada.",
      priority: "urgent"
    });
    const deps = makeDeps({ agentRun, handoffExecute, offHoursExecute });

    const result = await handleWebhook(deps, {
      rawBody: "{}",
      headers: { delivery: "delivery-3" },
      payload: payload("choqué y hay una persona lesionada")
    });

    expect(result.action).toBe("off_hours:emergency");
    expect(agentRun).toHaveBeenCalledOnce();
    expect(handoffExecute).not.toHaveBeenCalled();
    expect(offHoursExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "emergency",
        priority: "urgent",
        userFacingMessage: expect.stringContaining("0800-999-0000")
      })
    );
  });

  it("can escalate operational blockers outside business hours after LLM evaluation", async () => {
    vi.setSystemTime(new Date("2026-04-28T01:00:00.000Z"));
    const handoffExecute = vi.fn();
    const offHoursExecute = vi.fn();
    const agentRun = vi.fn().mockResolvedValue({
      action: "handoff",
      text: "Llamá a emergencias.",
      summary: "El usuario no puede abrir el auto en una reserva activa.",
      priority: "urgent",
      matchedSkillId: "auto_no_abre"
    });
    const deps = makeDeps({ agentRun, handoffExecute, offHoursExecute });

    const result = await handleWebhook(deps, {
      rawBody: "{}",
      headers: { delivery: "delivery-5" },
      payload: payload("no me abre el auto y tengo la reserva activa")
    });

    expect(result.action).toBe("off_hours:emergency");
    expect(handoffExecute).not.toHaveBeenCalled();
    expect(offHoursExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "emergency",
        priority: "urgent",
        matchedSkillId: "auto_no_abre",
        userFacingMessage: expect.stringContaining("0800-999-0000")
      })
    );
  });

  it("defers non-urgent agent handoff decisions outside business hours", async () => {
    vi.setSystemTime(new Date("2026-04-28T01:00:00.000Z"));
    const handoffExecute = vi.fn();
    const offHoursExecute = vi.fn();
    const agentRun = vi.fn().mockResolvedValue({
      action: "handoff",
      text: "Te derivo.",
      summary: "Caso administrativo para revisar.",
      priority: "medium"
    });
    const deps = makeDeps({ agentRun, handoffExecute, offHoursExecute });

    const result = await handleWebhook(deps, {
      rawBody: "{}",
      headers: { delivery: "delivery-4" },
      payload: payload("necesito revisar un cobro")
    });

    expect(result.action).toBe("off_hours:agent_decision");
    expect(handoffExecute).not.toHaveBeenCalled();
    expect(offHoursExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "agent_decision",
        summary: "Caso administrativo para revisar."
      })
    );
  });
});

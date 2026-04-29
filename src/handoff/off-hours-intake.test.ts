import { describe, expect, it, vi } from "vitest";
import type { ChatwootClient } from "../chatwoot/client.js";
import { ConversationStore } from "../state/conversation-store.js";
import { OffHoursIntakeExecutor } from "./off-hours-intake.js";

describe("OffHoursIntakeExecutor", () => {
  it("snoozes the conversation until the next opening when available", async () => {
    const chatwoot = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendPrivateNote: vi.fn().mockResolvedValue(undefined),
      togglePriority: vi.fn().mockResolvedValue(undefined),
      toggleStatus: vi.fn().mockResolvedValue(undefined)
    } as unknown as ChatwootClient;
    const store = new ConversationStore();
    const executor = new OffHoursIntakeExecutor(chatwoot, store);
    const nextOpenAt = new Date("2026-04-28T12:00:00.000Z");

    await executor.execute({
      conversationId: 123,
      reason: "explicit_request",
      userMessage: "quiero un operador",
      userFacingMessage: "Tomamos tu pedido.",
      hours: {
        isOpen: false,
        timezone: "America/Argentina/Buenos_Aires",
        localDate: "2026-04-27",
        localTime: "22:00",
        nextOpenAt
      },
      email: "user@example.com"
    });

    expect(chatwoot.toggleStatus).toHaveBeenCalledWith(123, "snoozed", {
      snoozedUntil: nextOpenAt
    });
    expect(store.get(123).phase).toBe("off_hours_intake");
    expect(store.get(123).email).toBe("user@example.com");
  });
});

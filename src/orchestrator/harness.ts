import type { AppConfig } from "../config.js";
import type {
  AgentAction,
  AgentRunMetrics
} from "../agent/conversational-agent.js";
import { runAgentTurn } from "../agent/conversational-agent.js";
import type { ToolRegistry, ToolboxContext } from "../agent/tools.js";
import { createDefaultToolRegistry } from "../agent/tools.js";
import {
  buildFarewellDecision,
  buildHandoffDecision,
  buildReplyDecision
} from "../fsm/engine.js";
import { isMeaningfulProblemText, parseInput } from "../fsm/input-parser.js";
import type {
  ConversationCategory,
  ConversationState,
  FsmDecision,
  ParsedInput
} from "../fsm/types.js";
import type { LoadedSkill } from "../skills/types.js";
import { preMatchSkill } from "../agent/skill-matcher.js";

export type OrchestratorInput = {
  content: string;
  currentState: ConversationState;
  toolbox: ToolboxContext;
};

export type OrchestratorSource =
  | "cold_start"
  | "trip_action_prompt"
  | "trip_damage_handoff"
  | "trip_emergency_handoff"
  | "category_set"
  | "category_retry"
  | "general_handoff"
  | "agent_reply"
  | "agent_ask_email"
  | "agent_resolve"
  | "agent_handoff"
  | "agent_retry"
  | "agent_fallback"
  | "email_captured"
  | "email_retry"
  | "handoff_explicit"
  | "farewell";

export type OrchestratorTrace = {
  source: OrchestratorSource;
  agentAction: AgentAction["kind"] | null;
  agentError: string | null;
  matchedSkillId: string | null;
  category: ConversationCategory | null;
  agentMetrics: AgentRunMetrics | null;
};

export type OrchestratorResult = {
  decision: FsmDecision;
  trace: OrchestratorTrace;
};

export class ConversationOrchestrator {
  private readonly registry: ToolRegistry;

  constructor(
    private readonly config: AppConfig,
    private readonly skills: LoadedSkill[],
    registry?: ToolRegistry
  ) {
    this.registry = registry ?? createDefaultToolRegistry();
  }

  async run(input: OrchestratorInput): Promise<OrchestratorResult> {
    const parsed = parseInput(input.content);

    if (parsed.signal === "handoff") {
      return {
        decision: buildHandoffDecision({
          currentState: input.currentState,
          signal: "handoff",
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: input.currentState.problem ?? input.content.trim(),
          addAgentNote: true
        }),
        trace: baseTrace("handoff_explicit", input.currentState)
      };
    }

    if (parsed.signal === "goodbye") {
      return {
        decision: buildFarewellDecision(input.currentState),
        trace: baseTrace("farewell", input.currentState)
      };
    }

    switch (input.currentState.state) {
      case "cold_start":
        return this.handleColdStart(input, parsed);
      case "awaiting_trip_action":
        return this.handleAwaitingTripAction(input, parsed);
      case "awaiting_category":
        return this.handleAwaitingCategory(input, parsed);
      case "agent_active":
        return this.handleAgentActive(input, parsed);
      case "awaiting_email":
        return this.handleAwaitingEmail(input, parsed);
      default:
        return {
          decision: buildHandoffDecision({
            currentState: input.currentState,
            signal: parsed.signal,
            replyKey: "HANDOFF_HUMAN",
            replyText: null,
            problem: input.currentState.problem ?? input.content.trim(),
            addAgentNote: true
          }),
          trace: baseTrace("handoff_explicit", input.currentState)
        };
    }
  }

  private handleColdStart(
    input: OrchestratorInput,
    parsed: ParsedInput
  ): OrchestratorResult {
    const email = parsed.email ?? input.currentState.email;
    return {
      decision: buildReplyDecision({
        currentState: input.currentState,
        replyKey: "WELCOME_TRIAGE",
        replyText: null,
        nextState: "awaiting_category",
        signal: parsed.signal,
        unknownAttempts: 0,
        email
      }),
      trace: baseTrace("cold_start", input.currentState)
    };
  }

  private async handleAwaitingTripAction(
    input: OrchestratorInput,
    parsed: ParsedInput
  ): Promise<OrchestratorResult> {
    const tripAction = parseTripAction(input.content);

    if (tripAction === "damage") {
      const agentState: ConversationState = {
        ...input.currentState,
        state: "agent_active",
        category: "tecnico",
        problem: "Reporte de daños al vehículo en viaje en curso",
        matchedSkillId: "reporte_danios_fotos"
      };
      const result = await this.runAgentWithState(
        agentState,
        parsed,
        "Quiero reportar daños al vehículo",
        input.toolbox
      );
      return { ...result, trace: { ...result.trace, source: "trip_damage_handoff" } };
    }

    if (tripAction === "emergency") {
      return {
        decision: buildHandoffDecision({
          currentState: input.currentState,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: "Emergencia durante viaje en curso",
          category: "tecnico",
          addAgentNote: true,
          priority: "urgent"
        }),
        trace: baseTrace("trip_emergency_handoff", input.currentState)
      };
    }

    return this.buildUnknownRetry(input.currentState, parsed, {
      nextState: "awaiting_trip_action",
      retryTemplate: "ASK_TRIP_ACTION",
      source: "trip_action_prompt"
    });
  }

  private async handleAwaitingCategory(
    input: OrchestratorInput,
    parsed: ParsedInput
  ): Promise<OrchestratorResult> {
    if (isTripEntry(input.content)) {
      return {
        decision: buildReplyDecision({
          currentState: input.currentState,
          replyKey: "ASK_TRIP_ACTION",
          replyText: null,
          nextState: "awaiting_trip_action",
          signal: parsed.signal,
          unknownAttempts: 0,
          category: "tecnico"
        }),
        trace: baseTrace("trip_action_prompt", input.currentState)
      };
    }

    if (parsed.signal === "category" && parsed.category) {
      const category = parsed.category;
      const followUp = categoryFollowUpText(category);
      return {
        decision: buildReplyDecision({
          currentState: input.currentState,
          replyKey: null,
          replyText: followUp,
          nextState: "agent_active",
          signal: parsed.signal,
          unknownAttempts: 0,
          category
        }),
        trace: {
          source: "category_set",
          agentAction: null,
          agentError: null,
          matchedSkillId: null,
          category,
          agentMetrics: null
        }
      };
    }

    if (parsed.signal === "email" && parsed.email) {
      return {
        decision: buildReplyDecision({
          currentState: input.currentState,
          replyKey: "ASK_CATEGORY_RETRY",
          replyText: null,
          nextState: "awaiting_category",
          signal: parsed.signal,
          unknownAttempts: input.currentState.unknownAttempts,
          email: parsed.email
        }),
        trace: baseTrace("category_retry", input.currentState)
      };
    }

    if (
      (parsed.signal === "text" || parsed.signal === "yes" || parsed.signal === "no") &&
      isMeaningfulProblemText(input.content)
    ) {
      const promoted: ConversationState = {
        ...input.currentState,
        state: "agent_active",
        problem: input.currentState.problem ?? input.content.trim(),
        category: null
      };
      return this.runAgentWithState(promoted, parsed, input.content, input.toolbox);
    }

    return this.buildUnknownRetry(input.currentState, parsed, {
      nextState: "awaiting_category",
      retryTemplate: "ASK_CATEGORY_RETRY",
      source: "category_retry"
    });
  }

  private async handleAgentActive(
    input: OrchestratorInput,
    parsed: ParsedInput
  ): Promise<OrchestratorResult> {
    const nextState: ConversationState = {
      ...input.currentState,
      email: parsed.email ?? input.currentState.email,
      problem: input.currentState.problem ?? input.content.trim()
    };

    return this.runAgentWithState(nextState, parsed, input.content, input.toolbox);
  }

  private async handleAwaitingEmail(
    input: OrchestratorInput,
    parsed: ParsedInput
  ): Promise<OrchestratorResult> {
    if (parsed.signal === "email" && parsed.email) {
      const updated: ConversationState = {
        ...input.currentState,
        state: "agent_active",
        email: parsed.email
      };
      const agentResult = await this.runAgentWithState(
        updated,
        parsed,
        input.content,
        input.toolbox
      );
      return {
        decision: agentResult.decision,
        trace: { ...agentResult.trace, source: "email_captured" }
      };
    }

    if (parsed.signal === "no") {
      return {
        decision: buildHandoffDecision({
          currentState: input.currentState,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: input.currentState.problem,
          addAgentNote: true
        }),
        trace: baseTrace("agent_handoff", input.currentState)
      };
    }

    if (parsed.signal === "text" && isMeaningfulProblemText(input.content)) {
      const updated: ConversationState = {
        ...input.currentState,
        state: "agent_active"
      };
      return this.runAgentWithState(updated, parsed, input.content, input.toolbox);
    }

    return this.buildUnknownRetry(input.currentState, parsed, {
      nextState: "awaiting_email",
      retryTemplate: "ASK_EMAIL_RETRY",
      source: "email_retry"
    });
  }

  private async runAgentWithState(
    state: ConversationState,
    parsed: ParsedInput,
    rawContent: string,
    toolbox: ToolboxContext
  ): Promise<OrchestratorResult> {
    if (!this.config.agentEnabled) {
      return {
        decision: buildHandoffDecision({
          currentState: state,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: state.problem ?? rawContent.trim(),
          addAgentNote: true
        }),
        trace: {
          ...baseTrace("agent_fallback", state),
          agentError: "agent_disabled"
        }
      };
    }

    let matchedSkillId = state.matchedSkillId;
    if (!matchedSkillId && this.config.skillMatcherModel) {
      matchedSkillId = await preMatchSkill({
        message: rawContent,
        skills: this.skills,
        category: state.category,
        openrouterBaseUrl: this.config.openrouterBaseUrl,
        openrouterApiKey: this.config.openrouterApiKey,
        matcherModel: this.config.skillMatcherModel,
        timeoutMs: this.config.openrouterTimeoutMs
      });
    }

    const agentResult = await runAgentTurn({
      context: {
        content: rawContent,
        category: state.category,
        email: state.email,
        history: state.history,
        state: state.state,
        matchedSkillId,
        priorContext: state.priorContext ?? null
      },
      skills: this.skills,
      config: this.config,
      toolbox,
      registry: this.registry
    });

    if (agentResult.action) {
      return translateAgentAction({
        action: agentResult.action,
        state,
        parsed,
        rawContent,
        metrics: agentResult.metrics
      });
    }

    const nextUnknown = state.unknownAttempts + 1;
    if (nextUnknown >= this.config.agentMaxRetries) {
      return {
        decision: buildHandoffDecision({
          currentState: state,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: state.problem ?? rawContent.trim(),
          addAgentNote: true,
          agentSummary: agentResult.error
            ? `Fallo del agente: ${agentResult.error}`
            : null
        }),
        trace: {
          ...baseTrace("agent_fallback", state),
          agentError: agentResult.error,
          agentMetrics: agentResult.metrics
        }
      };
    }

    const isTechnicalFailure = isTechnicalAgentError(agentResult.error);

    return {
      decision: buildReplyDecision({
        currentState: state,
        replyKey: isTechnicalFailure ? "AGENT_TECHNICAL_RETRY" : null,
        replyText: isTechnicalFailure
          ? null
          : "Perdón, no te entendí bien. ¿Podés contarme un poco más sobre lo que te pasa?",
        nextState: "agent_active",
        signal: parsed.signal,
        unknownAttempts: nextUnknown,
        category: state.category,
        problem: state.problem
      }),
      trace: {
        ...baseTrace("agent_retry", state),
        agentError: agentResult.error,
        agentMetrics: agentResult.metrics
      }
    };
  }

  private buildUnknownRetry(
    currentState: ConversationState,
    parsed: ParsedInput,
    options: {
      nextState: ConversationState["state"];
      retryTemplate: "ASK_TRIP_ACTION" | "ASK_CATEGORY_RETRY" | "ASK_EMAIL_RETRY";
      source: OrchestratorSource;
    }
  ): OrchestratorResult {
    const nextUnknown = currentState.unknownAttempts + 1;
    if (nextUnknown >= this.config.agentMaxRetries) {
      return {
        decision: buildHandoffDecision({
          currentState,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: null,
          problem: currentState.problem,
          addAgentNote: true
        }),
        trace: baseTrace("agent_fallback", currentState)
      };
    }

    return {
      decision: buildReplyDecision({
        currentState,
        replyKey: options.retryTemplate,
        replyText: null,
        nextState: options.nextState,
        signal: parsed.signal,
        unknownAttempts: nextUnknown
      }),
      trace: baseTrace(options.source, currentState)
    };
  }
}

function translateAgentAction(params: {
  action: AgentAction;
  state: ConversationState;
  parsed: ParsedInput;
  rawContent: string;
  metrics: AgentRunMetrics;
}): OrchestratorResult {
  const { action, state, parsed, rawContent, metrics } = params;
  const matchedSkillId = action.matchedSkillId ?? state.matchedSkillId;
  const problem = state.problem ?? rawContent.trim();
  const effectiveCategory = action.categoryChange ?? state.category;

  switch (action.kind) {
    case "reply":
      return {
        decision: buildReplyDecision({
          currentState: state,
          replyKey: null,
          replyText: action.text,
          nextState: "agent_active",
          signal: parsed.signal,
          unknownAttempts: 0,
          category: effectiveCategory,
          problem,
          matchedSkillId
        }),
        trace: {
          source: "agent_reply",
          agentAction: "reply",
          agentError: null,
          matchedSkillId,
          category: effectiveCategory,
          agentMetrics: metrics
        }
      };

    case "ask_email":
      return {
        decision: buildReplyDecision({
          currentState: state,
          replyKey: null,
          replyText: action.text,
          nextState: "awaiting_email",
          signal: parsed.signal,
          unknownAttempts: 0,
          category: effectiveCategory,
          problem,
          matchedSkillId
        }),
        trace: {
          source: "agent_ask_email",
          agentAction: "ask_email",
          agentError: null,
          matchedSkillId,
          category: effectiveCategory,
          agentMetrics: metrics
        }
      };

    case "resolve":
      return {
        decision: buildReplyDecision({
          currentState: state,
          replyKey: null,
          replyText: action.text,
          nextState: "cold_start",
          signal: parsed.signal,
          unknownAttempts: 0,
          category: null,
          problem: null,
          matchedSkillId: null
        }),
        trace: {
          source: "agent_resolve",
          agentAction: "resolve",
          agentError: null,
          matchedSkillId,
          category: state.category,
          agentMetrics: metrics
        }
      };

    case "handoff":
      return {
        decision: buildHandoffDecision({
          currentState: state,
          signal: parsed.signal,
          replyKey: "HANDOFF_HUMAN",
          replyText: action.text,
          problem,
          matchedSkillId,
          category: state.category,
          addAgentNote: true,
          agentSummary: action.summary,
          agentHandoffSummary: action.handoffSummary,
          priority: action.priority
        }),
        trace: {
          source: "agent_handoff",
          agentAction: "handoff",
          agentError: null,
          matchedSkillId,
          category: state.category,
          agentMetrics: metrics
        }
      };
  }
}

function categoryFollowUpText(category: ConversationCategory): string {
  if (category === "tecnico") {
    return "Dale, contame qué está pasando con la app o tu reserva y lo revisamos.";
  }
  if (category === "administrativo") {
    return "Perfecto. Contame el detalle del tema (cobros, cuenta, documentación) y lo revisamos.";
  }
  return "Contame qué necesitás y te oriento.";
}

function baseTrace(
  source: OrchestratorSource,
  state: ConversationState
): OrchestratorTrace {
  return {
    source,
    agentAction: null,
    agentError: null,
    matchedSkillId: state.matchedSkillId,
    category: state.category,
    agentMetrics: null
  };
}

function isTripEntry(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return /^1\)?$|^opcion\s*1$|\bviaje\b|\ben curso\b/.test(normalized);
}

function parseTripAction(content: string): "damage" | "emergency" | null {
  const normalized = content
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (/^1$|da[ñn]o|reportar/.test(normalized)) return "damage";
  if (/^2$|emergencia|urgente/.test(normalized)) return "emergency";
  return null;
}

function isTechnicalAgentError(error: string | null): boolean {
  if (!error) return false;
  return (
    error.startsWith("agent_exception:") ||
    error.startsWith("openrouter_") ||
    error === "agent_max_iterations" ||
    error === "agent_no_tool_call" ||
    error === "agent_invalid_action"
  );
}

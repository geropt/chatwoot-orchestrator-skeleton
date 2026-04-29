import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock
} from "@anthropic-ai/sdk/resources/messages";
import type { Skill } from "../skills/types.js";
import type { ConversationState } from "../state/conversation-store.js";
import type { BusinessHoursStatus } from "../support/business-hours.js";
import {
  EMIT_DECISION_TOOL,
  emitDecisionSchema,
  parseDecision,
  type AgentDecision
} from "./decision.js";
import { buildContextBlock, buildSystemPrompt } from "./prompt.js";
import { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";

export type AgentConfig = {
  model: string;
  temperature: number;
  maxTokens: number;
  maxToolIterations: number;
  maxRetries: number;
};

export type AgentRunInput = {
  state: ConversationState;
  userMessage: string;
  ctx: ToolContext;
  businessHours?: BusinessHoursStatus;
  emergencyPhone?: string;
};

export class Agent {
  constructor(
    private readonly client: Anthropic,
    private readonly skills: Skill[],
    private readonly tools: ToolRegistry,
    private readonly config: AgentConfig
  ) {}

  async run({
    state,
    userMessage,
    ctx,
    businessHours,
    emergencyPhone
  }: AgentRunInput): Promise<AgentDecision> {
    const { cacheable } = buildSystemPrompt(this.skills);
    const systemBlocks: TextBlockParam[] = [
      {
        type: "text",
        text: cacheable,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: buildContextBlock(state, businessHours, emergencyPhone)
      }
    ];

    const messages: MessageParam[] = [
      ...state.history.map<MessageParam>((h) => ({
        role: h.role,
        content: h.content
      })),
      { role: "user", content: userMessage }
    ];

    const extraTools = this.tools.toAnthropicSpecs();
    const toolsParam = [
      ...extraTools,
      {
        name: EMIT_DECISION_TOOL,
        description:
          "Emití la decisión final para este turno. Es obligatorio invocarla exactamente una vez.",
        input_schema: emitDecisionSchema
      }
    ];

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.runLoop(systemBlocks, messages, toolsParam, ctx);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError ?? new Error("Agent failed with no error captured");
  }

  private async runLoop(
    system: TextBlockParam[],
    initialMessages: MessageParam[],
    tools: Array<{
      name: string;
      description: string;
      input_schema: typeof emitDecisionSchema;
    }>,
    ctx: ToolContext
  ): Promise<AgentDecision> {
    const messages: MessageParam[] = [...initialMessages];

    for (let i = 0; i < this.config.maxToolIterations + 1; i++) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system,
        messages,
        tools,
        tool_choice: { type: "any" }
      });

      const toolUses = response.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use"
      );

      if (toolUses.length === 0) {
        throw new Error(
          `Agent did not invoke any tool (stop_reason=${response.stop_reason}).`
        );
      }

      const decisionCall = toolUses.find((t) => t.name === EMIT_DECISION_TOOL);
      if (decisionCall) {
        return parseDecision(decisionCall.input);
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        const output = await this.tools
          .execute(call.name, call.input, ctx)
          .catch((err: unknown) => ({
            error: err instanceof Error ? err.message : String(err)
          }));
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(output)
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    throw new Error(
      `Agent exceeded maxToolIterations (${this.config.maxToolIterations}) without emitting a decision.`
    );
  }
}

export type ToolContext = {
  conversationId: number;
  contactId?: number;
  email?: string;
};

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: ToolContext
) => Promise<TOutput>;

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: ToolHandler<TInput, TOutput>;
};

export type AnthropicToolSpec = {
  name: string;
  description: string;
  input_schema: JsonSchema;
};

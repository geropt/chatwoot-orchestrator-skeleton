import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { handleWebhook, type WebhookDeps } from "./chatwoot/webhook.js";
import type { ChatwootWebhookPayload } from "./chatwoot/types.js";

export async function buildServer(
  deps: WebhookDeps,
  opts: { logLevel: string }
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: opts.logLevel } });

  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true
  });

  app.get("/health", async () => ({ ok: true }));

  const handler = async (
    request: FastifyRequest<{ Body: ChatwootWebhookPayload }>,
    reply: FastifyReply
  ) => {
    const rawBody =
      typeof request.rawBody === "string"
        ? request.rawBody
        : Buffer.isBuffer(request.rawBody)
        ? request.rawBody.toString("utf8")
        : JSON.stringify(request.body ?? {});

    const headers = {
      signature: pickHeader(request.headers["x-chatwoot-signature"]),
      timestamp: pickHeader(request.headers["x-chatwoot-timestamp"]),
      delivery: pickHeader(request.headers["x-chatwoot-delivery"])
    };

    const payload = request.body ?? {};
    request.log.info(
      {
        event: payload.event,
        messageType: payload.message_type,
        senderType: payload.sender?.type,
        isPrivate: payload.private,
        conversationId: payload.conversation?.id,
        contentPreview:
          typeof payload.content === "string"
            ? payload.content.slice(0, 80)
            : undefined
      },
      "webhook received"
    );

    try {
      const result = await handleWebhook(deps, {
        rawBody,
        headers,
        payload
      });
      request.log.info({ result }, "webhook handled");
      if (!result.ok) {
        reply.code(401);
      }
      return result;
    } catch (err) {
      request.log.error({ err }, "webhook handler failed");
      reply.code(500);
      return { ok: false, error: "internal_error" };
    }
  };

  app.post<{ Body: ChatwootWebhookPayload }>(
    "/webhooks/chatwoot",
    { config: { rawBody: true } },
    handler
  );

  app.post<{ Body: ChatwootWebhookPayload }>(
    "/",
    { config: { rawBody: true } },
    handler
  );

  return app;
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

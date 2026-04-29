import Anthropic from "@anthropic-ai/sdk";
import { Agent } from "./agent/agent.js";
import { ToolRegistry } from "./agent/tools/registry.js";
import { ChatwootClient } from "./chatwoot/client.js";
import { loadConfig } from "./config.js";
import { HandoffExecutor } from "./handoff/executor.js";
import { OffHoursIntakeExecutor } from "./handoff/off-hours-intake.js";
import { buildServer } from "./server.js";
import { SkillsLoader } from "./skills/loader.js";
import { ConversationStore } from "./state/conversation-store.js";
import { DedupeStore } from "./state/dedupe-store.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const skills = new SkillsLoader(config.skillsDir);
  await skills.load();

  const chatwoot = new ChatwootClient(
    config.chatwoot.baseUrl,
    config.chatwoot.accountId,
    config.chatwoot.apiToken
  );

  const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

  const tools = new ToolRegistry();
  // Future tool registrations go here: tools.register({ name, description, inputSchema, handler })

  const agent = new Agent(anthropic, skills.getAll(), tools, {
    model: config.anthropic.model,
    temperature: config.agent.temperature,
    maxTokens: config.agent.maxTokens,
    maxToolIterations: config.agent.maxToolIterations,
    maxRetries: config.agent.maxRetries
  });

  const store = new ConversationStore();
  const dedupe = new DedupeStore();
  const handoff = new HandoffExecutor(chatwoot, store);
  const offHoursIntake = new OffHoursIntakeExecutor(chatwoot, store);

  const server = await buildServer(
    {
      chatwoot,
      agent,
      handoff,
      offHoursIntake,
      store,
      dedupe,
      config: {
        webhookSecret: config.chatwoot.webhookSecret,
        skipSignatureVerification: config.chatwoot.skipSignatureVerification,
        maxTurns: config.agent.maxTurns,
        maxRetries: config.agent.maxRetries,
        support: config.support
      }
    },
    { logLevel: config.logLevel }
  );

  await server.listen({ port: config.port, host: "0.0.0.0" });
  server.log.info(
    `listening on :${config.port} — skills=${skills.getAll().length} tools=${tools.size()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

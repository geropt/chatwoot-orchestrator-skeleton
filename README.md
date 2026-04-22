# MyKeego Support Bot

Harness de un agente conversacional de atención al cliente para MyKeego (carsharing) que se integra con Chatwoot como AgentBot. Hace triage usando las guías de `skills/`, ejecuta tool calls (registry listo para extender) y deriva a un operador humano cuando el caso excede sus capacidades.

## Stack

- Node.js + TypeScript (ESM, NodeNext)
- Fastify 5 como servidor HTTP
- `@anthropic-ai/sdk` para el LLM (Claude Sonnet 4.6 por default, con prompt caching)
- `gray-matter` para parsear los skills en Markdown

## Estructura

```
src/
├── index.ts                  # Entry point y wire-up
├── config.ts                 # Env vars
├── server.ts                 # Fastify + endpoints
├── chatwoot/
│   ├── client.ts             # Cliente HTTP de Chatwoot
│   ├── signature.ts          # Verificación HMAC
│   ├── webhook.ts            # Orquestador del flujo
│   └── types.ts
├── skills/
│   ├── loader.ts             # Carga skills/index.json + .md
│   └── types.ts
├── agent/
│   ├── agent.ts              # Loop LLM + tool use
│   ├── prompt.ts             # System prompt (bloque cacheable + contexto)
│   ├── decision.ts           # Tool "emit_decision"
│   └── tools/
│       ├── registry.ts       # Registry de tools (vacío por ahora)
│       └── types.ts
├── state/
│   ├── conversation-store.ts # Estado por conversación (in-memory)
│   └── dedupe-store.ts       # Dedupe de webhooks (TTL)
└── handoff/
    ├── rules.ts              # Detección explícita / max turns / error
    └── executor.ts           # toggleStatus + nota privada + estado

skills/                        # Catálogo de guías (.md + index.json)
```

## Setup

```bash
npm install
cp .env.example .env
# completar ANTHROPIC_API_KEY, CHATWOOT_*, etc.
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

## Variables de entorno

| Var | Descripción |
|---|---|
| `PORT` | Puerto del server (default 4000) |
| `LOG_LEVEL` | Nivel de log de Fastify (default `info`) |
| `CHATWOOT_BASE_URL` | URL base de la instancia de Chatwoot |
| `CHATWOOT_ACCOUNT_ID` | ID de la cuenta |
| `CHATWOOT_API_TOKEN` | `api_access_token` del AgentBot |
| `CHATWOOT_WEBHOOK_SECRET` | Secret del webhook (HMAC SHA256) |
| `CHATWOOT_SKIP_SIGNATURE_VERIFICATION` | `true` solo para desarrollo local |
| `SKILLS_DIR` | Directorio de skills (default `./skills`) |
| `ANTHROPIC_API_KEY` | API key de Anthropic |
| `ANTHROPIC_MODEL` | Modelo (default `claude-sonnet-4-6`) |
| `AGENT_MAX_TURNS` | Máximo de turnos antes de handoff automático (default 8) |
| `AGENT_MAX_RETRIES` | Reintentos ante error del LLM antes de handoff (default 2) |
| `AGENT_MAX_TOOL_ITERATIONS` | Máximo de iteraciones tool-use por turno (default 3) |
| `AGENT_TEMPERATURE` | Temperatura del modelo (default 0.3) |
| `AGENT_MAX_TOKENS` | Máximo de tokens de salida (default 1024) |

## Endpoints

- `GET /health` — liveness.
- `POST /webhooks/chatwoot` — entrada del AgentBot. Verifica firma, deduplica, filtra y responde con una acción (`reply`, `ask_email`, `resolve`, `handoff`).

## Arquitectura del flujo

1. Llega un evento `message_created` al webhook.
2. Se valida la firma HMAC (salvo `CHATWOOT_SKIP_SIGNATURE_VERIFICATION=true`).
3. Se deduplica por `x-chatwoot-delivery` + `payload.id`.
4. Se filtra: solo mensajes entrantes del contacto (no privados, no agente).
5. Si la conversación estaba en handoff y el agente humano la movió a `pending`, se reinicia el bot.
6. **Reglas duras pre-LLM**: si el usuario pide humano o se alcanzó `AGENT_MAX_TURNS`, handoff directo.
7. **Agente LLM** con:
   - System prompt en dos bloques: uno cacheable (rol + reglas + catálogo completo de skills) y uno variable (contexto del turno actual).
   - Tool-use forzado sobre `emit_decision` para salida estructurada.
   - Soporte para tools del registry (iterativo hasta `AGENT_MAX_TOOL_ITERATIONS`).
   - Reintentos ante error; tras `AGENT_MAX_RETRIES` dispara handoff con nota del fallo.
8. **Ejecución de la acción**:
   - `reply` → `sendMessage`.
   - `ask_email` → `sendMessage` + cambia fase a `awaiting_email`.
   - `resolve` → `sendMessage` + `toggleStatus("resolved")` + reset.
   - `handoff` → `toggleStatus("open")` + `togglePriority` + nota privada con resumen.

## Skills

Cada skill es un `.md` con frontmatter YAML:

```yaml
---
id: auxilio_mecanico_aca
title: Auxilio mecánico en ruta
description: ...
category: tecnico
ask_email: true
---

## Cuándo aplica
...
## Preguntas diagnósticas
...
## Pasos a guiar
...
## Cuándo derivar a operador
...
## Restricciones
...
```

El catálogo se resuelve vía `skills/index.json` al arrancar. Se cargan en memoria y se inyectan completos en el system prompt (con `cache_control: ephemeral`), así que las 27 guías actuales se pagan una sola vez cada 5 minutos.

## Tools (futuro)

El registry (`src/agent/tools/registry.ts`) está listo y vacío. Para sumar una tool real:

```ts
tools.register({
  name: "lookup_reservation",
  description: "Busca una reserva por código",
  inputSchema: {
    type: "object",
    required: ["code"],
    properties: { code: { type: "string" } }
  },
  handler: async (input, ctx) => { /* ... */ }
});
```

El loop del agente ya sabe ejecutar tool calls y reinyectar el resultado antes de emitir la decisión final.

## Configuración en Chatwoot

1. Crear un AgentBot apuntando el webhook a `https://tu-dominio/webhooks/chatwoot`.
2. Asociar el AgentBot al inbox (WhatsApp, widget, etc.).
3. Copiar el webhook secret al `.env` como `CHATWOOT_WEBHOOK_SECRET`.
4. El `api_access_token` del AgentBot se usa como `CHATWOOT_API_TOKEN`.

## Testing

```bash
npm test        # vitest run
npm run check   # tsc --noEmit
```

Tests cubren: verificación de firma, carga de skills, reglas de handoff, stores (conversation + dedupe) y parsing de la decisión del agente.

## Notas

- El estado de conversación y el dedupe son **in-memory** — para producción reemplazar por Redis manteniendo la misma interfaz.
- Prompt caching se aprovecha en el system prompt: el catálogo completo de skills queda cacheado 5 min, así que los turnos siguientes leen de cache.
- Tool calling está listo para extender pero sin tools concretas por ahora. Agregar integraciones a los sistemas de MyKeego es la próxima iteración.

# Chatwoot Bot (IVR mínimo + agente conversacional)

Base en Node.js/TypeScript para:

- Recibir eventos de Chatwoot (AgentBot webhook)
- Triage inicial por IVR simple (1/2/3)
- Conversar con un agente LLM que usa un catálogo de guías como contexto
- Derivar a humano con resumen cuando el agente no puede resolver

## 1) Instalar

```bash
npm install
```

## 2) Configurar entorno

```bash
cp .env.example .env
```

Variables requeridas:

- `CHATWOOT_BASE_URL`
- `CHATWOOT_ACCOUNT_ID`
- `CHATWOOT_API_TOKEN`
- `CHATWOOT_WEBHOOK_SECRET`

Variable opcional para desarrollo local:

- `CHATWOOT_SKIP_SIGNATURE_VERIFICATION` (`true|false`, default `false`)
- `SKILLS_DIR` (default `./skills`)

Variables del agente conversacional (requerido si `ENABLE_AGENT=true`):

- `ENABLE_AGENT` (`true|false`, default `true` si hay `OPENROUTER_API_KEY`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`)
- `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`)
- `OPENROUTER_TIMEOUT_MS` (default `8000`)
- `AGENT_TEMPERATURE` (default `0.3`)
- `AGENT_MAX_TOKENS` (default `320`)
- `AGENT_HISTORY_LIMIT` (default `12` — últimos N turnos enviados al LLM)
- `AGENT_MAX_RETRIES` (default `2` — intentos antes de derivar por fallo)

Si el agente está deshabilitado, el bot muestra el IVR y deriva directo a humano después de la categoría.

Variables para horarios laborales:

- `BUSINESS_HOURS_ENABLED` (`true|false`, default `false`)
- `BUSINESS_TIMEZONE` (default `America/Argentina/Buenos_Aires`)
- `BUSINESS_WORKING_DAYS` (default `1,2,3,4,5`, donde `0=domingo`)
- `BUSINESS_START_TIME` (default `09:00`)
- `BUSINESS_END_TIME` (default `18:00`)
- `BUSINESS_HOURS_LABEL`

## 3) Ejecutar

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

## Endpoints

- `GET /health`
- `POST /webhooks/chatwoot`
- `POST /` (alias de prueba)

## Arquitectura

### Estados

- `cold_start` → primer turno: bienvenida + IVR mínimo (1/2/3).
- `awaiting_category` → espera categoría o descripción libre.
- `agent_active` → cada turno llama al agente LLM.
- `awaiting_email` → el agente pidió email; cuando llega, vuelve a `agent_active`.
- `handoff_active` → bot dormido; se reactiva cuando la conversación vuelve a `pending`.

### Reglas duras (sin LLM)

- Si el usuario pide humano/agente/operador → handoff inmediato.
- Si el usuario se despide → cierre.
- Si el agente falla `AGENT_MAX_RETRIES` veces → handoff con nota de error.
- Si el handoff ocurre fuera de horario laboral (cuando está habilitado) → mensaje de fuera de horario.

### Agente conversacional

- Llamada al modelo vía OpenRouter con `response_format: json_object`.
- System prompt con: rol, tono, reglas duras, datos conocidos (categoría/email) y catálogo de guías filtrado por categoría.
- Historial enviado como `messages` (rol `user`/`assistant`), acotado por `AGENT_HISTORY_LIMIT`.
- Cada turno el agente devuelve **una** acción:
  - `reply` → responder y seguir conversando.
  - `ask_email` → pedir email y pasar a `awaiting_email`.
  - `resolve` → cerrar conversación (vuelve a `cold_start`).
  - `handoff` → derivar a operador con `text` para el usuario y `summary` para la nota privada.
- Si el agente es inválido o parsea mal → reintento con retry count; si se pasa, handoff.

## Skills (catálogo de guías)

- Directorio por default: `skills/`
- Archivo índice generado: `skills/index.json`
- Cada skill es un archivo `.md` con frontmatter YAML y secciones.

### Frontmatter

- `id` — id único (snake_case)
- `title` — nombre corto
- `description` — resumen de una línea
- `category` — `tecnico` | `administrativo` | `general`
- `ask_email` — `true` si el skill necesita email

### Secciones (headings `##`)

- `Cuándo aplica` → triggers / síntomas que llevan al skill
- `Preguntas diagnósticas` → qué preguntar antes de sugerir pasos
- `Pasos a guiar` → procedimiento paso a paso
- `Cuándo derivar a operador` → criterios de escalada
- `Restricciones` → qué no prometer / no hacer

Cada sección se escribe como bullets (`-` o `1.`).

Para regenerar el índice después de cambios:

```bash
npm run skills:ingest
```

## Configuración en Chatwoot

1. Crear AgentBot con webhook apuntando a `https://tu-dominio/webhooks/chatwoot`.
2. Asociar el AgentBot al inbox de WhatsApp/Twilio.
3. Guardar el `webhook secret` en `CHATWOOT_WEBHOOK_SECRET`.

## Notas

- El esqueleto usa memoria local para dedupe y estado de conversación (incluido el historial).
- Para producción, reemplazar esos stores por Redis y sumar cola/reintentos para el webhook.

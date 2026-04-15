# Chatwoot Bot Skeleton (Webhook + Reply + Handoff)

Base minima en Node.js/TypeScript para:

- Recibir eventos de Chatwoot (AgentBot webhook)
- Responder mensajes por API
- Hacer handoff a humano (`pending -> open`)

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
- `SKILLS_MIN_SCORE` (default `0.45`)

Variables opcionales para matching de skills con AI:

- `ENABLE_AI_SKILL_MATCHING` (`true|false`, default `auto` si hay `OPENROUTER_API_KEY`)
- `ENABLE_AI_SKILL_RESPONSE` (`true|false`, default `auto` si hay `OPENROUTER_API_KEY`)
- `AI_SKILL_MIN_CONFIDENCE` (default `0.65`)
- `AI_SKILL_MAX_CANDIDATES` (default `20`)
- `AI_SKILL_RESPONSE_MAX_CHARS` (default `420`)
- `ENABLE_AI_FAQ_CONFIRMATION` (`true|false`, default `auto` si hay `OPENROUTER_API_KEY`)
- `AI_FAQ_MIN_CONFIDENCE` (default `0.7`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`)
- `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`)
- `OPENROUTER_TIMEOUT_MS` (default `6000`)

Variables opcionales para horarios y dias laborales:

- `BUSINESS_HOURS_ENABLED` (`true|false`, default `false`)
- `BUSINESS_TIMEZONE` (default `America/Argentina/Buenos_Aires`)
- `BUSINESS_WORKING_DAYS` (default `1,2,3,4,5`, donde `0=domingo`)
- `BUSINESS_START_TIME` (default `09:00`)
- `BUSINESS_END_TIME` (default `18:00`)
- `BUSINESS_HOURS_LABEL` (texto para mensaje fuera de horario)

## 3) Ejecutar

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

## Endpoints

- `GET /health`: estado del servicio
- `POST /webhooks/chatwoot`: webhook principal de Chatwoot
- `POST /`: alias para pruebas (si en Chatwoot quedo configurada la raiz)

## Comportamiento actual (FSM intake en frio + skills)

- Procesa solo `event=message_created`
- Ignora mensajes no entrantes o privados
- Usa una maquina de estados por `conversation_id`:
  - `cold_start`
  - `handoff_active`
  - `awaiting_user_confirmation`
  - `awaiting_email`
  - `awaiting_problem`
  - `awaiting_faq_confirmation`
- Flujo:
  1. Saludo inicial abierto (sin preguntar "sos usuario")
  2. Orquestador evalua skills locales y, opcionalmente, usa AI para seleccionar la mejor
  3. Si la skill requiere identificacion (`ask_email`), pide mail antes de continuar
  4. Si encuentra skill, puede generar respuesta dinamica con AI usando la skill como contexto
  5. Pregunta si ayudo (si/no)
  6. Si no ayuda (o no hay skill), hace handoff a humano (`open`)
- Si en la confirmacion FAQ el usuario escribe un problema nuevo (texto libre), se deriva directo a humano
- Si se traba 2 veces en un mismo paso, hace handoff automatico
- Antes del handoff envia una nota privada al agente con resumen de preatencion
- Si el usuario no quiere compartir mail, el flujo sigue igual y pasa al paso de descripcion del problema
- Si el usuario describe el problema desde el inicio (sin responder si/no), el orquestador intenta resolver con skill FAQ o continua el intake sin trabarse
- Luego de handoff, el bot queda en `handoff_active` y no vuelve a intervenir hasta que la conversacion vuelva a `pending`
- Si el handoff ocurre fuera de horario laboral (cuando esta habilitado), informa el horario y deja la consulta en cola para el equipo

## Harness del orquestador

- El webhook delega toda la decision en `src/orchestrator/harness.ts`
- Pipeline actual:
  1. Parseo de input (`si/no`, email, handoff)
  2. Ranking local de skills por similitud
  3. Seleccion AI opcional sobre top candidatos
  4. Generacion AI opcional de respuesta basada en skill
  5. Clasificacion AI opcional para confirmacion FAQ (`yes/no/unknown`)
  6. Decision final en FSM deterministico

## Skills locales

- Directorio por default: `skills/`
- Archivo indice: `skills/index.json`
- Cada skill vive en su propio JSON y se referencia desde el indice
- Campos minimos de una skill:
  - `id`
  - `title`
  - `patterns` (frases para matching)
  - `response` o `guidance`

Campos opcionales:

- `ask_email` (si `true`, el bot solicita mail antes de resolver con esa skill)

Campos recomendados para skill no rigida:

- `guidance` (pasos/puntos de soporte que la AI usa para redactar)
- `constraints` (limites o advertencias para no prometer de mas)

Ejemplo de estructura:

```text
skills/
  index.json
  auto-no-abre.json
  reporte-danios-fotos.json
  problema-administrativo-ticket.json
```

## Configuracion en Chatwoot

1. Crear AgentBot (Settings -> Bots) con webhook apuntando a:
   - `https://tu-dominio/webhooks/chatwoot`
2. Asociar el AgentBot al inbox de WhatsApp/Twilio.
3. Guardar el `webhook secret` en `CHATWOOT_WEBHOOK_SECRET`.
   - Se ve en `Settings -> Bots -> [tu bot] -> Edit` (campo/secret de webhook).

## Notas

- Este esqueleto usa memoria local para deduplicacion de eventos.
- El estado del FSM tambien se guarda en memoria local.
- Para produccion, reemplazar dedupe + estado con Redis y agregar cola/reintentos.

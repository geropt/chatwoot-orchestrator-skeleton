import type { AppConfig } from "../config.js";
import type {
  ConversationCategory,
  ConversationStateName,
  ConversationTurn
} from "../fsm/types.js";
import type { LoadedSkill } from "../skills/types.js";
import {
  createDefaultToolRegistry,
  type AgentAction,
  type AgentActionKind,
  type EffectToolDef,
  type TerminalToolDef,
  type ToolboxContext,
  type ToolRegistry
} from "./tools.js";

export type { AgentAction, AgentActionKind } from "./tools.js";

export type AgentContext = {
  content: string;
  category: ConversationCategory | null;
  email: string | null;
  history: ConversationTurn[];
  state: ConversationStateName;
  matchedSkillId: string | null;
  priorContext: string | null;
};

export type AgentRunMetrics = {
  llmDurationMs: number;
  llmIterations: number;
  systemPromptChars: number;
  historyLen: number;
};

export type AgentRunResult = {
  action: AgentAction | null;
  error: string | null;
  usedFallback: boolean;
  metrics: AgentRunMetrics;
};

type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type LlmAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type LlmToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | LlmAssistantMessage
  | LlmToolMessage;

export async function runAgentTurn(params: {
  context: AgentContext;
  skills: LoadedSkill[];
  config: AppConfig;
  toolbox: ToolboxContext;
  registry?: ToolRegistry;
}): Promise<AgentRunResult> {
  const { context, skills, config, toolbox } = params;
  const registry = params.registry ?? createDefaultToolRegistry();

  const historyMessages = buildHistoryMessages(
    context.history,
    config.agentHistoryLimit
  );
  const emptyMetrics: AgentRunMetrics = {
    llmDurationMs: 0,
    llmIterations: 0,
    systemPromptChars: 0,
    historyLen: historyMessages.length
  };

  if (!config.agentEnabled) {
    return {
      action: null,
      error: "agent_disabled",
      usedFallback: false,
      metrics: emptyMetrics
    };
  }

  const relevantSkills = filterSkillsByCategory(skills, context.category);
  const systemPrompt = buildSystemPrompt({
    category: context.category,
    email: context.email,
    state: context.state,
    skills: relevantSkills,
    matchedSkillId: context.matchedSkillId,
    effectTools: registry.effects(),
    priorContext: context.priorContext
  });

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: context.content }
  ];

  const metrics: AgentRunMetrics = {
    llmDurationMs: 0,
    llmIterations: 0,
    systemPromptChars: systemPrompt.length,
    historyLen: historyMessages.length
  };

  const maxIterations = Math.max(1, config.agentMaxToolIterations);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const startedAt = Date.now();
    const response = await callOpenRouter({ messages, config, registry });
    metrics.llmDurationMs += Date.now() - startedAt;
    metrics.llmIterations += 1;

    if (response.error) {
      return {
        action: null,
        error: response.error,
        usedFallback: false,
        metrics
      };
    }

    const toolCalls = response.toolCalls;
    if (!toolCalls.length) {
      return {
        action: null,
        error: "agent_no_tool_call",
        usedFallback: false,
        metrics
      };
    }

    const terminalCall = toolCalls.find(call => {
      const def = registry.get(call.name);
      return def?.kind === "terminal";
    });

    if (terminalCall) {
      const def = registry.get(terminalCall.name) as TerminalToolDef;
      const args = parseToolArgs(terminalCall.arguments);
      if (!args) {
        toolbox.logger.warn(
          { toolName: terminalCall.name, rawArguments: terminalCall.arguments },
          "agent_invalid_action: failed to parse tool arguments"
        );
        return {
          action: null,
          error: "agent_invalid_action",
          usedFallback: false,
          metrics
        };
      }
      const action = def.toAction(args, relevantSkills);
      if (!action) {
        toolbox.logger.warn(
          { toolName: terminalCall.name, parsedArgs: args },
          "agent_invalid_action: toAction returned null"
        );
        return {
          action: null,
          error: "agent_invalid_action",
          usedFallback: false,
          metrics
        };
      }
      return { action, error: null, usedFallback: false, metrics };
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: toolCalls.map(call => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments }
      }))
    });

    for (const call of toolCalls) {
      const def = registry.get(call.name);
      const toolResponse = await executeEffectTool({
        call,
        def,
        toolbox,
        timeoutMs: config.openrouterTimeoutMs
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResponse
      });
    }
  }

  return {
    action: null,
    error: "agent_max_iterations",
    usedFallback: false,
    metrics
  };
}

async function callOpenRouter(params: {
  messages: LlmMessage[];
  config: AppConfig;
  registry: ToolRegistry;
}): Promise<{
  toolCalls: LlmToolCall[];
  error: string | null;
}> {
  const { messages, config, registry } = params;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.openrouterTimeoutMs
  );

  try {
    const response = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        temperature: config.agentTemperature,
        max_tokens: config.agentMaxTokens,
        tools: registry.schemas(),
        tool_choice: "required",
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        toolCalls: [],
        error: `openrouter_${response.status}:${body.slice(0, 200)}`
      };
    }

    const body = (await response.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };

    const rawCalls = body.choices?.[0]?.message?.tool_calls ?? [];
    const toolCalls: LlmToolCall[] = [];
    for (const raw of rawCalls) {
      const name = raw.function?.name;
      const args = raw.function?.arguments;
      if (typeof name !== "string" || typeof args !== "string") continue;
      toolCalls.push({
        id: raw.id ?? `call_${toolCalls.length}`,
        name,
        arguments: args
      });
    }

    return { toolCalls, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return { toolCalls: [], error: `agent_exception:${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeEffectTool(params: {
  call: LlmToolCall;
  def: ReturnType<ToolRegistry["get"]>;
  toolbox: ToolboxContext;
  timeoutMs: number;
}): Promise<string> {
  const { call, def, toolbox, timeoutMs } = params;

  if (!def) {
    toolbox.logger.warn(
      { toolName: call.name },
      "Agent called unknown tool"
    );
    return JSON.stringify({ ok: false, error: "unknown_tool" });
  }

  if (def.kind !== "effect") {
    return JSON.stringify({
      ok: false,
      error: "terminal_tool_cannot_be_executed_as_effect"
    });
  }

  const args = parseToolArgs(call.arguments);
  if (!args) {
    return JSON.stringify({ ok: false, error: "invalid_arguments" });
  }

  const startedAt = Date.now();
  try {
    const result = await withTimeout(def.run(args, toolbox), timeoutMs);
    toolbox.logger.info(
      {
        toolName: def.name,
        durationMs: Date.now() - startedAt,
        ok: result.ok
      },
      "Agent effect tool executed"
    );
    return typeof result.content === "string"
      ? result.content
      : JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "tool_error";
    toolbox.logger.error(
      {
        toolName: def.name,
        durationMs: Date.now() - startedAt,
        error: message
      },
      "Agent effect tool failed"
    );
    return JSON.stringify({ ok: false, error: message });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`tool_timeout_${timeoutMs}ms`)),
      timeoutMs
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function filterSkillsByCategory(
  skills: LoadedSkill[],
  category: ConversationCategory | null
): LoadedSkill[] {
  if (category === "general") return skills;
  if (category === null) {
    return skills.filter(skill => skill.category !== "general");
  }
  return skills.filter(
    skill => skill.category === null || skill.category === category
  );
}

function buildSystemPrompt(params: {
  category: ConversationCategory | null;
  email: string | null;
  state: ConversationStateName;
  skills: LoadedSkill[];
  matchedSkillId: string | null;
  effectTools: EffectToolDef[];
  priorContext: string | null;
}): string {
  const { category, email, state, skills, matchedSkillId, effectTools, priorContext } = params;

  const expandedSkill =
    matchedSkillId != null
      ? (skills.find(s => s.id === matchedSkillId) ?? null)
      : null;

  const catalog = skills.length
    ? skills
        .map(skill =>
          skill.id === expandedSkill?.id
            ? formatSkillExpanded(skill)
            : formatSkillCompact(skill)
        )
        .join("\n\n")
    : "(no hay skills especificos para esta categoria)";

  const knownData = [
    `- categoria: ${category ?? "sin clasificar (el usuario todavia no eligio)"}`,
    `- email del usuario: ${email ?? "no informado"}`,
    `- estado actual: ${state}`,
    `- skill activo: ${expandedSkill ? expandedSkill.id : "ninguno todavia"}`
  ].join("\n");

  const terminalInstruction = effectTools.length
    ? "En cada turno el ultimo paso es elegir UNA tool terminal:"
    : "En cada turno elegi UNA tool:";

  const sections: string[] = [
    [
      "Contexto de negocio (fuente de verdad para preguntas informativas; podes usar estos datos sin necesidad de un skill):",
      "- MyKeego es el primer servicio de carsharing de Argentina. Plataforma 100% digital, operacion 24/7, mas de 125.000 clientes.",
      "- Como funciona: el usuario reserva desde la app, va al Keego Point asignado, abre el auto con la app, y lo devuelve al mismo punto. Se puede reservar por minutos, horas, dias o semanas, hasta 30 dias de anticipacion.",
      "- Keego Points: son los estacionamientos fijos donde se retiran y devuelven los autos. No se puede dejar el auto en otro lugar.",
      "- Requisitos: tarjeta de credito a nombre del titular (VISA, Mastercard o AMEX; no se acepta debito). Al registrarse se hace una autorizacion de $15.000 que se cancela inmediatamente (no es un cobro).",
      "- Cobros: 70% al confirmar la reserva + 30% + combustible + peajes al finalizar. Cuotas: hasta 3 sin interes en reservas tradicionales, hasta 6 sin interes en packs. Extensiones en un solo pago.",
      "- Cancelaciones: hasta 45 minutos antes sin costo; hasta 24 horas antes, 30% del monto; con menos de 24 horas, 60% del monto.",
      "- Seguro incluido: responsabilidad civil y cobertura contra daños y robo con franquicia. El seguro solo es valido cuando conduce el titular de la cuenta.",
      "- Prohibiciones: fumar dentro del auto, transportar animales sin jaula, dejar conducir a terceros, circular por caminos no pavimentados, conducir bajo efectos de alcohol o drogas.",
      "- Cuentas Business disponibles para empresas (factura tipo A, flotilla con telemetria y gestion integral).",
      "- Peajes: todos los autos tienen telepase propio, el usuario no necesita usar el suyo. Los peajes se cobran a la tarjeta del perfil a medida que los cobros llegan, luego de finalizada la reserva. Cada usuario es responsable de los peajes consumidos durante su reserva.",
      "- Precios por minuto/hora/dia, modelos de autos disponibles y ubicaciones exactas de Keego Points NO estan incluidos aqui: para eso deriva a operador o indica al usuario que consulte la app."
    ].join("\n"),
    [
      "Rol: sos el asistente virtual de soporte de MyKeego (car sharing en Argentina). Atendes por WhatsApp.",
      "Tono: natural, cercano, rioplatense, sin sonar robotico. Sin emojis. Mensajes breves (1-3 oraciones). No termines cada mensaje con una pregunta: si acabas de dar un paso o confirmar algo, deja que el usuario responda solo. Solo pregunta cuando genuinamente necesitas informacion para avanzar.",
      "Objetivo: acompañar al usuario paso a paso para resolver lo que se pueda. Derivar a humano solo cuando el skill lo indica, cuando ya se intento y no funciono, o ante una emergencia real."
    ].join("\n"),
    buildUserModeSection(category),
    [
      "Como usar el catalogo de skills:",
      "- Los skills aparecen en modo compacto (id, titulo, descripcion, cuando aplica). El skill activo aparece expandido con 'preguntas diagnosticas', 'pasos', 'cuando derivar' y 'restricciones'.",
      "1. Si aun no hay skill activo: identifica cual matchea segun 'cuando aplica' y el titulo, seteá `matched_skill_id` con su id y hace una primera pregunta diagnostica breve o pedí un detalle concreto para confirmar. En el proximo turno vas a ver los pasos completos del skill elegido. Si la pregunta del usuario ya puede responderse con el 'Contexto de negocio' de este prompt, respondela directamente sin esperar — pero sin agregar nada que no este ahi.",
      "2. Si ya hay skill activo (figura como [SKILL ACTIVO]): guia al usuario EXCLUSIVAMENTE por los 'pasos' del skill. No uses conocimiento general ni informacion externa al skill para responder — si la respuesta no esta en los pasos o preguntas diagnosticas del skill, no la inventes. De a uno o dos pasos por mensaje, y despues de cada paso verifica si funciono antes de pasar al siguiente.",
      "3. Si se cumple un criterio de 'cuando derivar' del skill activo, hace handoff con summary.",
      "4. Si el contexto deja claro que el skill activo ya no aplica, cambia `matched_skill_id` al que corresponda (o null) y volve al punto 1.",
      "5. Si ningun skill encaja con lo que el usuario reporta, NO improvises pasos de resolucion. Pedi UN detalle concreto (que mensaje aparece, en que pantalla se traba, que estaba intentando hacer) para ver si eso te permite matchear un skill. Si con ese detalle sigue sin haber skill que aplique y no es emergencia, deriva a operador con summary claro."
    ].join("\n"),
    [
      "Reglas duras:",
      "- Solo hablas de temas relacionados a MyKeego y el servicio de car sharing en Argentina.",
      "- Emergencia real (accidente con lesion, choque, incendio, robo en curso): handoff inmediato.",
      "- Si no hay skill del catalogo que cubra lo que pregunta el usuario, podes responder SOLO con informacion que figure explicitamente en la seccion 'Contexto de negocio' de este prompt. Lo que NO esta ahi (precios por minuto/hora/dia, modelos de autos, ubicaciones exactas de Keego Points, promociones, politicas no listadas) NO lo inventes ni lo supongas aunque creas saberlo. En esos casos: o pedis un detalle concreto para ver si cae en un skill, o derivas a operador con summary tipo 'usuario consulta X, fuera de catalogo de skills'.",
      "- No inventes politicas, precios, plazos, datos de la cuenta, NI sintomas, errores o diagnosticos que el usuario no haya mencionado explicitamente. Trabaja solo con lo que el usuario efectivamente dijo. Esto aplica en TODOS los modos: si la informacion no esta en el skill activo ni en el contexto de negocio de este prompt, no la digas.",
      "- NUNCA respondas con datos tecnicos de un vehiculo especifico (tipo de combustible, aceite, presion de neumaticos, capacidad del tanque, especificaciones del motor, etc.). Esa informacion la tiene el auto impresa o en el manual. Si el usuario pregunta por combustible, seguí el skill correspondiente: la respuesta correcta es siempre 'fijate en la tapa del tanque'.",
      "- No prometas reembolsos, desbloqueos ni compensaciones; eso lo decide un humano.",
      "- Si ya diste un paso y el usuario dice que no funciono, pasa al siguiente paso del skill o deriva si ya se agotaron.",
      "- Si el usuario ya dio su email, no lo pidas de vuelta.",
      "- Respuestas off-topic o sin sentido: si la respuesta del usuario no guarda relacion con la pregunta que acabas de hacer (ej. respondes '¿que mensaje de error ves?' y contesta con algo sin relacion), NO asumas una respuesta ni avances con un paso. Volve a preguntar lo mismo de forma mas simple o clarificando que necesitas. Si despues de 2 intentos el usuario sigue sin colaborar con la info necesaria, deriva con un summary honesto tipo 'usuario reporta X pero no respondio al pedido de detalle necesario para diagnosticar'.",
      "- Inputs sin sentido: si el mensaje del usuario no se puede relacionar claramente con un problema real de MyKeego (ej. palabras aleatorias, objetos que no tienen relacion con autos o reservas, preguntas absurdas), NO intentes matchear un skill ni respondas con informacion tecnica. Responde con algo como 'No entiendo bien qué necesitás, ¿podés contarme qué te pasa con el auto o la reserva?'"
    ].join("\n"),
    [
      terminalInstruction,
      "- reply: seguir conversando (preguntar, guiar un paso, verificar si funciono).",
      "- ask_email: pedir el email del usuario (solo aplica a usuarios registrados en categoria tecnico o administrativo; NUNCA para consulta informativa).",
      "- resolve: cerrar la conversacion (el usuario confirmo que se resolvio o se despidio bien).",
      "- handoff: derivar a humano (no podes resolverlo o es una emergencia)."
    ].join("\n")
  ];

  if (effectTools.length) {
    const effectLines = [
      "Herramientas de consulta disponibles (se pueden llamar antes de una tool terminal):"
    ];
    for (const tool of effectTools) {
      effectLines.push(`- ${tool.name}: ${tool.schema.function.description}`);
      if (tool.promptHint) {
        effectLines.push(`  hint: ${tool.promptHint}`);
      }
    }
    effectLines.push(
      "Si llamas a una herramienta de consulta, vas a recibir su resultado y despues elegis la tool terminal."
    );
    sections.push(effectLines.join("\n"));
  }

  sections.push(
    [
      "Como redactar `text` (siempre va al usuario por WhatsApp):",
      "- Segunda persona (vos/te/tu). Nunca en tercera.",
      "- No describas al usuario ni a vos mismo desde afuera.",
      '- Correcto en handoff: "Te paso con un operador para que te ayude con la consulta."',
      '- INCORRECTO: "El usuario informa que X" o "Derivo a un operador".'
    ].join("\n"),
    [
      "Como redactar la nota interna del handoff (parametros `summary_problem`, `summary_attempted`, `summary_reason`):",
      "- Es para el operador humano que recibe el caso. Tercera persona, sin saludos, sin emojis.",
      "- `summary_problem` (obligatorio): que reporta el usuario en concreto, en 1 oracion. Ej: 'Reporta que el auto no abre desde la app aunque la reserva figura activa'.",
      "- `summary_attempted` (opcional, null si no se intento nada): que pasos se le guiaron y resultado. Ej: 'Se le pidio reiniciar la app y verificar senal; ambos pasos sin exito'. Null si no llegamos a guiar nada (ej. emergencia, fuera de catalogo, usuario pidio humano de entrada).",
      "- `summary_reason` (obligatorio): por que se deriva ahora, en 1 oracion. Opciones tipicas: 'Pasos del skill agotados', 'Emergencia con riesgo a personas', 'Usuario solicita hablar con humano', 'Consulta fuera del catalogo de skills', 'Usuario reporta bloqueo administrativo que requiere accion del operador'."
    ].join("\n"),
    "`matched_skill_id`: id del skill que estas aplicando este turno. Null si ninguno encaja.",
    "`category_change` (opcional, solo en `reply` y `ask_email`): usar SOLO cuando el usuario revela que su intent real no coincide con la categoria actual (ej. entro como informativa pero resulta ser cliente con un problema). Pasar 'tecnico' / 'administrativo' / 'general' segun donde deberia estar. En el resto de los turnos, dejar ausente o null.",
    [
      "`priority` (solo tiene efecto en handoff):",
      '- "urgent": emergencia real con riesgo a personas (accidente con lesion, choque, incendio, robo en curso, auto parado en lugar peligroso).',
      '- "high": caso sensible que bloquea al usuario y necesita atencion rapida (auxilio mecanico en ruta sin lesiones, auto no abre con reserva activa, cobro erroneo urgente).',
      "- null: caso administrativo o consulta comun sin urgencia."
    ].join("\n"),
    ["Datos conocidos:", knownData].join("\n"),
    ...(priorContext
      ? [
          [
            "Interacciones previas del contacto (ultimas conversaciones antes de esta):",
            priorContext,
            "Reglas para usar este contexto:",
            "- Si el email ya figura en una conversacion previa, usalo directamente. NO pidas el email de nuevo.",
            "- Si el problema es igual o similar al de una conversacion anterior, reconocelo y seguí desde ahi sin volver a preguntar lo mismo.",
            "- Si hay info relevante ya capturada (modelo del auto, error reportado, etc.), asumila como valida y no la repregunte salvo que el usuario la contradiga."
          ].join("\n")
        ]
      : []),
    ["Catalogo de skills para esta categoria:", catalog].join("\n")
  );

  return sections.join("\n\n");
}

function buildUserModeSection(category: ConversationCategory | null): string {
  if (category === "general") {
    return [
      "Modo del usuario: CONSULTA INFORMATIVA (prospect, todavia no es cliente).",
      "- NO le pidas email ni uses la tool `ask_email`. No tiene cuenta.",
      "- REGLA CLAVE: NUNCA respondas con informacion sustantiva sobre el servicio usando conocimiento propio o suposiciones. La unica fuente valida es el contenido explicitamente incluido en este prompt: la seccion 'Contexto de negocio' o los 'pasos'/'descripcion' del skill EXPANDIDO ([SKILL ACTIVO]).",
      "- Si la respuesta a la consulta del usuario esta en el 'Contexto de negocio': respondela directamente desde ahi, sin necesidad de activar un skill.",
      "- Si el skill ya esta expandido (figura como [SKILL ACTIVO]): respondé usando SOLO el contenido textual de sus 'pasos' y 'descripcion'. No parafrasees ni agregues nada que no este ahi.",
      "- NO derives a operador por defecto. Solo hace handoff si el usuario lo pide explicitamente, si pregunta algo comercial/financiero especifico que un humano deberia responder, o si la consulta esta fuera del catalogo de skills.",
      "- Si la pregunta no esta cubierta por ningun skill, decile que no tenes esa informacion a mano y pregunta si quiere que lo derives a un operador.",
      "- ESCAPE A FLUJO CLIENTE: si el usuario describe un problema concreto que esta viviendo ahora (ej. 'no me abre el auto', 'me cobraron mal', 'no carga la app', 'mi reserva no aparece'), no sigas en modo prospect a ciegas. Primero, en una `reply` breve, preguntá: '¿tenés una reserva activa con MyKeego ahora?'. Si te confirma que si, en tu PROXIMA respuesta usá `category_change` con 'tecnico' (problemas con app/auto/reserva) o 'administrativo' (cobros/cuenta/documentacion) segun corresponda, junto con `ask_email` para pedirle el email. A partir de ese turno la conversacion pasa a modo cliente y vos seguis con el skill paso a paso. Si te dice que no es cliente, segui en modo prospect explicativo."
    ].join("\n");
  }
  if (category === "tecnico" || category === "administrativo") {
    return [
      `Modo del usuario: CLIENTE REGISTRADO (categoria ${category}).`,
      "- Si todavia no tenemos su email, ANTES de arrancar con diagnostico o pasos llamá a `ask_email` para pedirle el email con el que se registro en MyKeego. Sin ese dato, no avances.",
      "- Una vez que tengas el email (o si ya lo teniamos), guia paso a paso segun el skill, verificando despues de cada paso si funciono.",
      "- Usa los pasos del skill activo tal como estan. Si el usuario se queda bloqueado, deriva con summary."
    ].join("\n");
  }
  return [
    "Modo del usuario: SIN CLASIFICAR todavia.",
    "- Si el historial deja claro que es consulta informativa (frases tipo 'consulto', 'puedo?', 'se puede?', 'como funciona', 'no soy usuario', 'estoy averiguando'), trata al usuario como prospect: no pidas email, responde explicativo.",
    "- Si el historial deja claro que es un cliente con un problema concreto ('no me abre', 'me cobraron mal', 'no puedo cancelar', 'tengo una reserva'), trata como cliente: pedí email primero si no lo tenemos, despues seguí con el skill.",
    "- Si no esta claro, tu primera respuesta debe ser pedirle que elija: tecnico (problema con app/auto), administrativo (cobros/cuenta) o consulta informativa (no es usuario todavia)."
  ].join("\n");
}

function formatSkillCompact(skill: LoadedSkill): string {
  const lines: string[] = [
    `- id: ${skill.id}`,
    `  titulo: ${skill.title}`
  ];
  if (skill.description) {
    lines.push(`  descripcion: ${skill.description}`);
  }
  appendBulletSection(lines, "cuando aplica", skill.triggers);
  return lines.join("\n");
}

function formatSkillExpanded(skill: LoadedSkill): string {
  const lines: string[] = [
    `- id: ${skill.id}  [SKILL ACTIVO]`,
    `  titulo: ${skill.title}`
  ];
  if (skill.description) {
    lines.push(`  descripcion: ${skill.description}`);
  }
  appendBulletSection(lines, "cuando aplica", skill.triggers);
  appendBulletSection(lines, "preguntas diagnosticas", skill.diagnosticQuestions);
  appendBulletSection(lines, "pasos", skill.steps);
  appendBulletSection(lines, "cuando derivar", skill.escalateWhen);
  appendBulletSection(lines, "restricciones", skill.constraints);
  return lines.join("\n");
}

function appendBulletSection(lines: string[], label: string, items: string[]): void {
  if (!items.length) return;
  lines.push(`  ${label}:`);
  for (const item of items) {
    lines.push(`    - ${item}`);
  }
}

function buildHistoryMessages(
  history: ConversationTurn[],
  limit: number
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!history.length) {
    return [];
  }
  const trimmed = history.slice(-limit);
  return trimmed.map(turn => ({ role: turn.role, content: turn.content }));
}

function parseToolArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

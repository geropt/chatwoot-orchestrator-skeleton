/**
 * Normaliza el formato de un mensaje generado por el LLM para que renderice
 * correctamente en WhatsApp (el canal principal vía Chatwoot).
 *
 * WhatsApp usa sintaxis propia:
 *   *negrita*, _itálica_, ~tachado~, ```código```
 *
 * Si el LLM emite markdown estándar (`**negrita**`, `__negrita__`), WhatsApp
 * solo parsea el par interno y deja los asteriscos extra como caracteres
 * literales. Esta función convierte la sintaxis de markdown común a la
 * sintaxis de WhatsApp y limpia construcciones que en WhatsApp solo agregan
 * ruido (encabezados, links markdown, backticks de código inline).
 */
export function toWhatsappFormatting(text: string): string {
  if (!text) return text;

  let out = text;

  // **bold** -> *bold*  (no atravesar saltos de línea)
  out = out.replace(/\*\*([^\n*][^\n]*?[^\n*]|\S)\*\*/g, "*$1*");

  // __bold__ -> *bold*  (variante de markdown)
  out = out.replace(/__([^\n_][^\n]*?[^\n_]|\S)__/g, "*$1*");

  // [texto](url) -> texto (url)
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");

  // Encabezados markdown al inicio de línea: "# Título" -> "Título"
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");

  // `código inline` -> código inline (WhatsApp no lo respeta y queda feo)
  out = out.replace(/`([^`\n]+)`/g, "$1");

  // Quitar risas y emoticonos: son inaceptables para atención al cliente.
  // Matchea solo tokens "aislados" (entre límites de palabra o puntuación/espacio)
  // para no destruir palabras legítimas.
  const laughterPattern =
    /(^|[\s,.;:!?¡¿(){}\[\]"'-])(j[aeiou](?:\s*j[aeiou])+|lo+l|lmao|xd+|jaja+|jeje+|jiji+|jojo+)(?=$|[\s,.;:!?(){}\[\]"'-])/giu;
  out = out.replace(laughterPattern, "$1");

  // Emoticonos ASCII básicos: :), :-), :D, ;), :P, xD (case-insensitive)
  out = out.replace(
    /(^|\s)(?::-?\)|:-?D|;-?\)|:-?P|:-?\(|:-?\/|<3)(?=$|\s|[.,;:!?])/gi,
    "$1"
  );

  // Limpieza de espacios sobrantes que pudieron quedar tras remover tokens.
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+([.,;:!?])/g, "$1");
  // Trim por línea: los mensajes de chat no usan indentación.
  out = out
    .split("\n")
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n");

  return out;
}

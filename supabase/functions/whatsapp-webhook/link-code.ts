// Comando de vinculación de WhatsApp: "VINCULAR <código>".
// Acepta el código nuevo (12 caracteres en grupos de 4) y, durante la
// transición, el formato anterior de 6 dígitos. Devuelve el código
// normalizado (mayúsculas, sin espacios ni guiones) o null si el texto no
// tiene forma de código. El hash que calcula el llamador es sobre este valor.
const LINK_COMMAND = /^vincular\s+(?:([a-z0-9]{4})[\s-]?([a-z0-9]{4})[\s-]?([a-z0-9]{4})|(\d{6}))$/i;

export function parseLinkCommand(text: string): string | null {
  const match = text.trim().match(LINK_COMMAND);
  if (!match) return null;
  const code = match[4] ?? `${match[1]}${match[2]}${match[3]}`;
  return code.toUpperCase();
}

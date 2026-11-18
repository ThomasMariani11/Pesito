// Comando de vinculación de WhatsApp: "VINCULAR <código>".
// El código tiene 12 caracteres del alfabeto de la migración 054, en grupos de
// 4 separados por guion o todo junto (sin distinguir mayúsculas). Devuelve el
// código normalizado (mayúsculas, sin guiones) o null si el texto no tiene
// forma de código; en ese caso el mensaje sigue el camino normal y no suma
// intentos. El hash que calcula el llamador es sobre el valor devuelto.
const GROUP = "[23456789abcdefghjklmnpqrstuvwxyz]{4}";
const LINK_COMMAND = new RegExp(
  `^vincular\\s+(${GROUP}-${GROUP}-${GROUP}|${GROUP}${GROUP}${GROUP})$`,
  "i",
);

export function parseLinkCommand(text: string): string | null {
  const match = text.trim().match(LINK_COMMAND);
  return match ? match[1].replaceAll("-", "").toUpperCase() : null;
}

// Regla de contraseñas acordada con el propietario (19/11/2026). Debe coincidir con la configuración de
// Supabase Auth (Minimum password length 8; requisitos: minúsculas, mayúsculas y dígitos).
export const PASSWORD_RULE = 'Usá al menos 8 caracteres, con mayúsculas, minúsculas y números.';

export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

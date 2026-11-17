// SEC-03 (Fase 1.1): verificación en dos pasos (TOTP de Supabase Auth) obligatoria para el administrador.
// El servidor exige AAL2 en is_admin() y admin_renew_subscription() (migración 052); esta capa solo guía la UI.
// Si el administrador pierde su dispositivo, el factor se elimina desde el panel de Supabase
// (Authentication → Users → el usuario → MFA) y vuelve a inscribirse desde la app.
import type { SupabaseClient } from '@supabase/supabase-js';

export type MfaApi = SupabaseClient['auth']['mfa'];
export type AdminAal = 'aal1' | 'aal2' | null;
export type AdminMfaStep = { kind: 'verify'; factorId: string } | { kind: 'enroll' };

/** Nivel de la sesión actual. Se calcula con el JWT local; no requiere red. */
export async function readAdminAal(mfa: Pick<MfaApi, 'getAuthenticatorAssuranceLevel'>): Promise<AdminAal> {
  const { data, error } = await mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return null;
  return data.currentLevel === 'aal2' ? 'aal2' : 'aal1';
}

/**
 * Decide si el administrador debe verificar un factor existente o inscribir uno nuevo.
 * Los factores TOTP sin verificar de intentos anteriores se eliminan (permitido con AAL1),
 * para que una inscripción abandonada no bloquee la siguiente.
 */
export async function resolveAdminMfaStep(mfa: Pick<MfaApi, 'listFactors' | 'unenroll'>): Promise<AdminMfaStep> {
  const { data, error } = await mfa.listFactors();
  if (error || !data) throw new Error('No pudimos consultar la verificación en dos pasos.');
  const verified = data.all.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  if (verified) return { kind: 'verify', factorId: verified.id };
  for (const factor of data.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      const result = await mfa.unenroll({ factorId: factor.id });
      if (result.error) throw new Error('No pudimos reiniciar la verificación en dos pasos.');
    }
  }
  return { kind: 'enroll' };
}

/** Deja solo dígitos y como máximo 6, sin interpretar el contenido pegado. */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

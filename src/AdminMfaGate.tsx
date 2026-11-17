import { FormEvent, useEffect, useState } from 'react';
import { useUpdateBlocker } from './PwaUpdates';
import { normalizeTotpCode, resolveAdminMfaStep, type AdminMfaStep, type MfaApi } from './adminMfa';

type Enrollment = { factorId: string; qrCode: string; secret: string };

interface Props {
  mfa: Pick<MfaApi, 'listFactors' | 'unenroll' | 'enroll' | 'challengeAndVerify'>;
  onVerified: () => void;
  onBack: () => void;
}

/** Paso previo al panel de administración: inscribir o verificar el código TOTP (AAL2). */
export function AdminMfaGate({ mfa, onVerified, onBack }: Props) {
  const [step, setStep] = useState<AdminMfaStep | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useUpdateBlocker(busy || Boolean(enrollment), 'Terminá la verificación en dos pasos antes de actualizar.');

  useEffect(() => {
    let active = true;
    resolveAdminMfaStep(mfa)
      .then((next) => { if (active) setStep(next); })
      .catch(() => { if (active) setError('No pudimos consultar la verificación en dos pasos. Intentá de nuevo.'); });
    return () => { active = false; };
  }, [mfa]);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: enrollError } = await mfa.enroll({ factorType: 'totp', friendlyName: 'Pesito admin' });
      if (enrollError || !data || data.type !== 'totp') throw new Error('enroll');
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setError('No pudimos iniciar la inscripción. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const factorId = enrollment?.factorId ?? (step?.kind === 'verify' ? step.factorId : null);
    if (!factorId) return;
    if (code.length !== 6) {
      setError('Ingresá los 6 dígitos que muestra tu app de autenticación.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setCode('');
      setError('El código no es válido o ya venció. Probá con el código nuevo.');
      return;
    }
    setEnrollment(null);
    onVerified();
  }

  const enrolling = step?.kind === 'enroll';
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="admin-mfa-title">
        <p className="eyebrow">ADMINISTRACIÓN</p>
        <h1 id="admin-mfa-title">Verificación en dos pasos</h1>
        {step === null && !error && <p className="loading-copy" role="status">Consultando tu verificación…</p>}

        {enrolling && !enrollment && (
          <>
            <p>Para abrir el panel de administración necesitás un código de una app de autenticación (por ejemplo, Google Authenticator o Authy).</p>
            <button type="button" onClick={() => void startEnrollment()} disabled={busy}>
              {busy ? 'Preparando…' : 'Configurar verificación'}
            </button>
          </>
        )}

        {enrollment && (
          <>
            <p>Escaneá este código con tu app de autenticación y escribí el código de 6 dígitos que te muestra.</p>
            <img className="admin-mfa-qr" src={enrollment.qrCode} alt="Código QR para la app de autenticación" width={200} height={200} />
            <p className="admin-mfa-secret">
              ¿No podés escanear? Ingresá esta clave a mano: <code>{enrollment.secret}</code>
            </p>
          </>
        )}

        {(enrollment || step?.kind === 'verify') && (
          <form onSubmit={(event) => void verify(event)}>
            <label>
              Código de 6 dígitos
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
                placeholder="123456"
              />
            </label>
            <button type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Verificar'}</button>
          </form>
        )}

        {error && <p className="form-message form-message-error" role="alert">{error}</p>}

        <p className="admin-mfa-help">
          Si perdés el dispositivo, eliminá el factor desde el panel de Supabase (Authentication → Users) y volvé a configurarlo acá.
        </p>
        <button type="button" className="button-link" onClick={onBack}>Volver al resumen</button>
      </section>
    </main>
  );
}

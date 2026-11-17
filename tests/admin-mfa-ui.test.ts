// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMfaGate } from '../src/AdminMfaGate';
import { normalizeTotpCode, readAdminAal, resolveAdminMfaStep } from '../src/adminMfa';

// SEC-03: paso de verificación en dos pasos antes del panel de administración. auth.mfa simulado; datos ficticios.
vi.mock('../src/PwaUpdates', () => ({ useUpdateBlocker: vi.fn() }));

type Factor = { id: string; factor_type: string; status: 'verified' | 'unverified' };
function mfaMock(factors: Factor[] = [], options: { verifyError?: boolean } = {}) {
  return {
    listFactors: vi.fn(async () => ({ data: { all: factors, totp: factors.filter((f) => f.status === 'verified'), phone: [] }, error: null })),
    unenroll: vi.fn(async () => ({ data: {}, error: null })),
    enroll: vi.fn(async () => ({
      data: { id: 'factor-nuevo', type: 'totp', friendly_name: 'Pesito admin', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRETOFICTICIO', uri: 'otpauth://ficticio' } },
      error: null,
    })),
    challengeAndVerify: vi.fn(async () => (options.verifyError ? { data: null, error: { message: 'Invalid TOTP code' } } : { data: {}, error: null })),
  };
}

let root: Root;
let container: HTMLDivElement;
const onVerified = vi.fn();
const onBack = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onVerified.mockReset();
  onBack.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(mfa: ReturnType<typeof mfaMock>) {
  await act(async () => {
    // El componente solo usa los cuatro métodos simulados.
    root.render(createElement(AdminMfaGate, { mfa: mfa as never, onVerified, onBack }));
  });
}
async function type(value: string) {
  const input = container.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function click(text: string) {
  const target = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!target) throw new Error(`No se encontró el botón: ${text}`);
  await act(async () => { target.click(); });
}

describe('SEC-03 · helpers de MFA', () => {
  it('normaliza el código a 6 dígitos', () => {
    expect(normalizeTotpCode(' 12 34-56 78')).toBe('123456');
    expect(normalizeTotpCode('abc')).toBe('');
  });

  it('readAdminAal informa aal2 solo cuando la sesión lo tiene', async () => {
    const level = (currentLevel: string) => ({ getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel, nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null })) });
    expect(await readAdminAal(level('aal2') as never)).toBe('aal2');
    expect(await readAdminAal(level('aal1') as never)).toBe('aal1');
    expect(await readAdminAal({ getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: null, error: { message: 'x' } })) } as never)).toBeNull();
  });

  it('con un factor verificado pide verificar; sin él limpia los no verificados e inscribe', async () => {
    const verified = mfaMock([{ id: 'f1', factor_type: 'totp', status: 'verified' }]);
    expect(await resolveAdminMfaStep(verified as never)).toEqual({ kind: 'verify', factorId: 'f1' });
    expect(verified.unenroll).not.toHaveBeenCalled();
    const stale = mfaMock([{ id: 'viejo', factor_type: 'totp', status: 'unverified' }]);
    expect(await resolveAdminMfaStep(stale as never)).toEqual({ kind: 'enroll' });
    expect(stale.unenroll).toHaveBeenCalledWith({ factorId: 'viejo' });
  });
});

describe('SEC-03 · pantalla de verificación del administrador', () => {
  it('inscribe el factor, muestra el QR y verifica el código', async () => {
    const mfa = mfaMock();
    await render(mfa);
    await click('Configurar verificación');
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Pesito admin' });
    expect(container.querySelector('img.admin-mfa-qr')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    await type('123456');
    await submit();
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-nuevo', code: '123456' });
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('con un factor ya verificado pide solo el código', async () => {
    const mfa = mfaMock([{ id: 'f1', factor_type: 'totp', status: 'verified' }]);
    await render(mfa);
    expect(container.textContent).not.toContain('Configurar verificación');
    await type('654321');
    await submit();
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '654321' });
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('un código incorrecto no habilita el panel y muestra un error', async () => {
    const mfa = mfaMock([{ id: 'f1', factor_type: 'totp', status: 'verified' }], { verifyError: true });
    await render(mfa);
    await type('000000');
    await submit();
    expect(onVerified).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('no es válido');
  });

  it('un código incompleto no se envía', async () => {
    const mfa = mfaMock([{ id: 'f1', factor_type: 'totp', status: 'verified' }]);
    await render(mfa);
    await type('123');
    await submit();
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('Volver no verifica nada', async () => {
    await render(mfaMock());
    await click('Volver al resumen');
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from '../src/Login';
import { PASSWORD_RULE } from '../src/passwordPolicy';

// Pantalla de ingreso simplificada (19/11/2026): debajo del botón solo "¿Olvidaste tu contraseña?".
// La recuperación usa un código de un solo uso enviado por correo (funciona en cualquier dispositivo).
const api = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), signInWithPassword: vi.fn(), signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn(),
}));
vi.mock('../src/supabase', () => ({
  supabase: {
    rpc: api.rpc, from: api.from,
    auth: {
      signInWithPassword: api.signInWithPassword, signInWithOtp: api.signInWithOtp,
      resetPasswordForEmail: api.resetPasswordForEmail, verifyOtp: api.verifyOtp, updateUser: api.updateUser,
    },
  },
}));
vi.mock('../src/PwaUpdates', () => ({ useUpdateBlocker: vi.fn() }));

let root: Root, node: HTMLDivElement;
const text = () => node.textContent ?? '';
const button = (label: string) => [...node.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
async function mount(search = '') {
  window.history.replaceState(null, '', `/chatbot-gastos/${search}`);
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root.render(h(Login)));
}
async function openRecovery() {
  await act(async () => button('¿Olvidaste tu contraseña?')!.click());
  await type(node.querySelector<HTMLInputElement>('input[type="email"]')!, '  ficticia@example.invalid ');
  await submit();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  api.rpc.mockResolvedValue({ data: { valid: true, duration_days: 30 }, error: null });
  api.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  api.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'synthetic' } }, error: null });
  api.updateUser.mockResolvedValue({ data: { user: { id: 'synthetic' } }, error: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('pantalla de ingreso simplificada', () => {
  it('debajo del botón solo ofrece recuperar la contraseña', async () => {
    await mount();
    expect(button('¿Olvidaste tu contraseña?')).toBeDefined();
    expect(text()).not.toContain('¿Preferís recibir un enlace por correo?');
    expect(text()).not.toContain('¿Tenés un código de invitación?');
    expect(button('Crear cuenta')).toBeDefined(); // la pestaña de alta se mantiene
  });

  it('el ?code= de Supabase (inicio de sesión o confirmación) no se toma como invitación', async () => {
    await mount('?code=7f3a9c12-4b5d-4e6f-8a9b-0c1d2e3f4a5b');
    expect(text()).toContain('Ingresá con tu usuario y contraseña');
    expect(node.querySelector('input.invite-code-input')).toBeNull();
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it.each(['?invitacion=PESO-ABCD-EFGH-JKLM', '?code=PESO-ABCD-EFGH-JKLM', '?invite=peso-abcd-efgh-jklm'])('un enlace de invitación abre el alta con el código (%s)', async (search) => {
    await mount(search);
    expect(node.querySelector<HTMLInputElement>('input.invite-code-input')!.value).toBe('PESO-ABCD-EFGH-JKLM');
  });
});

describe('recuperar la contraseña con un código por correo', () => {
  it('pide el código sin revelar si el correo existe', async () => {
    await mount();
    await openRecovery();
    expect(api.resetPasswordForEmail).toHaveBeenCalledWith('ficticia@example.invalid');
    expect(text()).toContain('Si el correo está registrado, te enviamos un código');
    expect(node.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
  });

  it('una contraseña nueva que no cumple la regla no se envía', async () => {
    await mount();
    await openRecovery();
    await type(node.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!, '123456');
    for (const field of node.querySelectorAll<HTMLInputElement>('input[type="password"]')) await type(field, 'clave2026');
    await submit();
    expect(text()).toContain(PASSWORD_RULE);
    expect(api.verifyOtp).not.toHaveBeenCalled();
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it('las contraseñas tienen que coincidir', async () => {
    await mount();
    await openRecovery();
    await type(node.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!, '123456');
    const [first, second] = node.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await type(first, 'Clave2026'); await type(second, 'Clave2027');
    await submit();
    expect(text()).toContain('Las contraseñas no coinciden.');
    expect(api.verifyOtp).not.toHaveBeenCalled();
  });

  it('valida el código y guarda la contraseña nueva', async () => {
    await mount();
    await openRecovery();
    await type(node.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!, ' 123 456 ');
    for (const field of node.querySelectorAll<HTMLInputElement>('input[type="password"]')) await type(field, 'Clave2026');
    await submit();
    expect(api.verifyOtp).toHaveBeenCalledWith({ email: 'ficticia@example.invalid', token: '123456', type: 'recovery' });
    expect(api.updateUser).toHaveBeenCalledWith({ password: 'Clave2026' });
    expect(text()).toContain('Listo, tu contraseña quedó cambiada.');
  });

  it('un código inválido o vencido no cambia la contraseña', async () => {
    api.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Token has expired or is invalid' } });
    await mount();
    await openRecovery();
    await type(node.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!, '123456');
    for (const field of node.querySelectorAll<HTMLInputElement>('input[type="password"]')) await type(field, 'Clave2026');
    await submit();
    expect(text()).toContain('El código no es válido o ya venció. Pedí uno nuevo.');
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it('se puede volver a iniciar sesión', async () => {
    await mount();
    await act(async () => button('¿Olvidaste tu contraseña?')!.click());
    await act(async () => button('← Volver a iniciar sesión')!.click());
    expect(button('¿Olvidaste tu contraseña?')).toBeDefined();
  });

  it('ya no existe el ingreso con enlace por correo', async () => {
    await mount();
    await openRecovery();
    expect(api.signInWithOtp).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// SEC-02: el Panel Admin pide el código al servidor (admin_create_invitation_code) y muestra su vencimiento.
const state = vi.hoisted(() => ({
  codes: [] as Record<string, unknown>[],
  rpc: null as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  inserts: [] as string[],
  loads: 0,
}));

vi.mock('../src/BotOperations', () => ({ BotOperations: () => null }));
vi.mock('../src/SubscriptionPayments', () => ({ SubscriptionPayments: () => null }));
vi.mock('../src/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'invitation_codes') state.loads++;
      const data = table === 'invitation_codes' ? state.codes : table === 'system_config' ? [] : [];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lt', 'abortSignal', 'delete', 'upsert']) q[m] = () => q;
      q.insert = () => { state.inserts.push(table); return q; };
      q.maybeSingle = () => Promise.resolve({ data: null, error: null });
      q.single = q.maybeSingle;
      q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: data.length }).then(done);
      return q;
    },
    rpc: (...args: unknown[]) => state.rpc(...args),
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => {},
  },
}));

import { AdminPanel } from '../src/AdminPanel';

const created = { id: 'code-new', code: 'PESO-ABCD-EFGH-JKLM', duration_days: 30, expires_at: '2026-11-24T12:00:00Z' };
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('SEC-02: invitaciones generadas por el servidor en el Panel Admin', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: Mock<(text: string) => Promise<void>>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.codes = [];
    state.inserts = [];
    state.rpc = vi.fn(async (...args: unknown[]) => (args[0] === 'admin_create_invitation_code' ? { data: created, error: null } : { data: [], error: null }));
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function openInvitations() {
    await act(async () => { root.render(h(AdminPanel, { userId: 'admin-1', onBack: () => {}, onSignOut: () => {} })); });
    await vi.waitFor(() => expect(container.querySelector('.admin-workspace-nav')).not.toBeNull());
    const tab = Array.from(container.querySelectorAll('.admin-workspace-nav button')).find((b) => b.textContent?.includes('Invitaciones')) as HTMLButtonElement;
    await act(async () => { tab.click(); });
  }
  async function submitNewCode(duration?: string, note?: string) {
    const open = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Nueva invitación') as HTMLButtonElement;
    await act(async () => { open.click(); });
    if (duration) await act(async () => { setValue(container.querySelector('#admin-invite-duration') as HTMLSelectElement, duration); });
    if (note) await act(async () => { setValue(container.querySelector('#admin-invite-note') as HTMLInputElement, note); });
    await act(async () => { (container.querySelector('#admin-new-invitation form') as HTMLFormElement).requestSubmit(); });
  }
  const calls = () => state.rpc.mock.calls.filter((c: unknown[]) => c[0] === 'admin_create_invitation_code');

  it('Generar código llama a la RPC con duración y nota y muestra el código devuelto', async () => {
    await openInvitations();
    await submitNewCode(undefined, 'Nota');
    expect(calls()).toEqual([['admin_create_invitation_code', { p_duration_days: 30, p_notes: 'Nota' }]]);
    expect(state.inserts).toEqual([]);
    await vi.waitFor(() => expect(container.querySelector('.code-token')?.textContent).toBe('PESO-ABCD-EFGH-JKLM'));
  });

  it('"Sin vencimiento" envía p_duration_days null', async () => {
    await openInvitations();
    await submitNewCode('lifetime');
    expect(calls()).toEqual([['admin_create_invitation_code', { p_duration_days: null, p_notes: null }]]);
  });

  it('si la RPC falla muestra el error y no muestra un código', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    state.rpc = vi.fn(async (...args: unknown[]) => (args[0] === 'admin_create_invitation_code'
      ? { data: null, error: { message: 'Verificá tu identidad con el código de dos pasos para crear invitaciones.' } }
      : { data: [], error: null }));
    await openInvitations();
    await submitNewCode();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Verificá tu identidad'));
    expect(container.querySelector('.code-token')).toBeNull();
  });

  it('la lista muestra "Vence el …" en disponibles y "Vencido" si expires_at ya pasó', async () => {
    const base = { duration_days: 30, is_used: false, used_by: null, used_at: null, created_by: 'admin-1', notes: null, created_at: '2026-11-10T00:00:00Z' };
    state.codes = [
      { ...base, id: 'c1', code: 'PESO-VIGE-NTEE-AAAA', expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { ...base, id: 'c2', code: 'PESO-VENC-IDOO-BBBB', expires_at: new Date(Date.now() - 86_400_000).toISOString() },
    ];
    await openInvitations();
    const rows = Array.from(container.querySelectorAll('.admin-codes-table tbody tr'));
    const row = (code: string) => rows.find((r) => r.textContent?.includes(code))!;
    expect(row('PESO-VIGE-NTEE-AAAA').querySelector('.admin-code-status-cell')?.textContent).toMatch(/^Vence el /);
    expect(row('PESO-VENC-IDOO-BBBB').querySelector('.admin-code-status-cell')?.textContent).toBe('Vencido');
    expect(row('PESO-VENC-IDOO-BBBB').querySelector('.admin-row-actions button[aria-label^="Copiar código"]')).toBeNull();
  });

  it('un código vencido se puede anular y no cuenta como disponible ni como usado', async () => {
    const base = { duration_days: 30, used_by: null, used_at: null, created_by: 'admin-1', notes: null, created_at: '2026-11-10T00:00:00Z' };
    state.codes = [
      { ...base, id: 'c1', code: 'PESO-VIGE-NTEE-AAAA', is_used: false, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { ...base, id: 'c2', code: 'PESO-VENC-IDOO-BBBB', is_used: false, expires_at: new Date(Date.now() - 86_400_000).toISOString() },
      { ...base, id: 'c3', code: 'PESO-USAD-OOOO-CCCC', is_used: true, used_at: '2026-11-12T00:00:00Z', expires_at: null },
    ];
    await openInvitations();
    const expired = Array.from(container.querySelectorAll('.admin-codes-table tbody tr')).find((r) => r.textContent?.includes('PESO-VENC-IDOO-BBBB'))!;
    expect(Array.from(expired.querySelectorAll('.admin-row-actions button')).map((b) => b.textContent)).toEqual(['Anular']);
    const pills = Object.fromEntries(Array.from(container.querySelectorAll('.admin-code-filters button'))
      .map((b) => [b.childNodes[0].textContent?.trim(), b.querySelector('span')?.textContent]));
    expect(pills).toEqual({ Todas: '3', Disponibles: '1', Vencidas: '1', Usadas: '1' });
  });

  it('el mensaje de una fila usa la fecha de vencimiento de ese código', async () => {
    state.codes = [{ id: 'c1', code: 'PESO-VIGE-NTEE-AAAA', duration_days: 30, is_used: false, used_by: null, used_at: null, created_by: 'admin-1',
      notes: null, created_at: '2026-11-10T00:00:00Z', expires_at: '2099-03-05T15:00:00Z' }];
    await openInvitations();
    await act(async () => { (container.querySelector('button[aria-label="Copiar mensaje de PESO-VIGE-NTEE-AAAA"]') as HTMLButtonElement).click(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/El enlace vence el 5 de mar\.? de 2099\./));
  });

  it('el mensaje de WhatsApp del código recién creado indica su fecha de vencimiento', async () => {
    await openInvitations();
    await submitNewCode();
    await vi.waitFor(() => expect(container.querySelector('.code-token')).not.toBeNull());
    const copyMsg = Array.from(container.querySelectorAll('.generated-code-box button')).find((b) => b.textContent === 'Copiar mensaje') as HTMLButtonElement;
    await act(async () => { copyMsg.click(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/El enlace vence el 24 de nov\.? de 2026\./));
  });
  it('la duración vitalicia se lee como membresía, no como vencimiento del código', async () => {
    state.codes = [{ id: 'c1', code: 'PESO-VITA-LICI-AAAA', duration_days: null, is_used: false, used_by: null, used_at: null, created_by: 'admin-1',
      notes: null, created_at: '2026-11-10T00:00:00Z', expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }];
    await openInvitations();
    const row = container.querySelector('.admin-codes-table tbody tr')!;
    expect(row.querySelector('.admin-code-duration-cell')?.textContent).toBe('Membresía vitalicia');
    const open = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Nueva invitación') as HTMLButtonElement;
    await act(async () => { open.click(); });
    expect((container.querySelector('#admin-invite-duration option[value="lifetime"]') as HTMLOptionElement).textContent).toBe('Membresía vitalicia');
  });

  it('si la RPC responde sin código, avisa que puede haberse creado y recarga la lista', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    state.rpc = vi.fn(async (...args: unknown[]) => (args[0] === 'admin_create_invitation_code' ? { data: {}, error: null } : { data: [], error: null }));
    await openInvitations();
    const before = state.loads;
    await submitNewCode();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Revisá la lista'));
    expect(container.querySelector('.code-token')).toBeNull();
    await vi.waitFor(() => expect(state.loads).toBeGreaterThan(before));
  });

  it('los campos de código muestran ejemplos del formato vigente', () => {
    const src = (f: string) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    expect(src('Login.tsx')).toContain('placeholder="PESO-XXXX-XXXX-XXXX"');
    for (const f of ['Paywall.tsx', 'Settings.tsx']) {
      expect(src(f)).not.toContain('placeholder="PESO-XXXX"');
      expect(src(f)).toContain('placeholder="Pegá el código que te enviamos"');
    }
  });
  it('el cartel del código recién creado se puede cerrar', async () => {
    await openInvitations();
    await submitNewCode();
    await vi.waitFor(() => expect(container.querySelector('.generated-code-box')).not.toBeNull());
    await act(async () => { (container.querySelector('.generated-code-box button[aria-label="Cerrar invitación creada"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('.generated-code-box')).toBeNull();
  });

  it('anular el código recién creado también cierra su cartel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    state.codes = [{ id: created.id, code: created.code, duration_days: 30, is_used: false, used_by: null, used_at: null, created_by: 'admin-1',
      notes: null, created_at: '2026-11-17T00:00:00Z', expires_at: created.expires_at }];
    await openInvitations();
    await submitNewCode();
    await vi.waitFor(() => expect(container.querySelector('.generated-code-box')).not.toBeNull());
    const annul = Array.from(container.querySelectorAll('.admin-codes-table tbody tr button')).find((b) => b.textContent === 'Anular') as HTMLButtonElement;
    await act(async () => { annul.click(); });
    await vi.waitFor(() => expect(container.querySelector('.generated-code-box')).toBeNull());
  });
  it('al crear la invitación el formulario se cierra y queda el cartel', async () => {
    await openInvitations();
    await submitNewCode();
    await vi.waitFor(() => expect(container.querySelector('.generated-code-box')).not.toBeNull());
    expect(container.querySelector('#admin-new-invitation')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Nueva invitación')).toBe(true);
  });

  it('si falla la creación el formulario queda abierto', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    state.rpc = vi.fn(async (...args: unknown[]) => (args[0] === 'admin_create_invitation_code' ? { data: null, error: { message: 'x' } } : { data: [], error: null }));
    await openInvitations();
    await submitNewCode();
    expect(container.querySelector('#admin-new-invitation')).not.toBeNull();
  });
});

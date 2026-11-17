// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// SEC-02: el Panel Admin pide el código al servidor (admin_create_invitation_code) y muestra su vencimiento.
const state = vi.hoisted(() => ({
  codes: [] as Record<string, unknown>[],
  rpc: null as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  inserts: [] as string[],
}));

vi.mock('../src/BotOperations', () => ({ BotOperations: () => null }));
vi.mock('../src/SubscriptionPayments', () => ({ SubscriptionPayments: () => null }));
vi.mock('../src/supabase', () => ({
  supabase: {
    from: (table: string) => {
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

  it('el mensaje de WhatsApp menciona que el enlace vence en 7 días', async () => {
    await openInvitations();
    await submitNewCode();
    await vi.waitFor(() => expect(container.querySelector('.code-token')).not.toBeNull());
    const copyMsg = Array.from(container.querySelectorAll('.generated-code-box button')).find((b) => b.textContent === 'Copiar mensaje') as HTMLButtonElement;
    await act(async () => { copyMsg.click(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('El enlace vence en 7 días'));
  });
});

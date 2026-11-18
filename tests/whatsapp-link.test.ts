import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { rpc } }));
import { requestWhatsAppLinkCode } from '../src/whatsappLink';

beforeEach(() => rpc.mockReset());
describe('contrato de vinculación de la PWA', () => {
  it('solicita un código sin enviar identidad, teléfono ni vencimiento', async () => {
    rpc.mockResolvedValue({ data:{code:'123456',expires_at:'2026-10-14T23:00:00Z'}, error:null });
    expect(await requestWhatsAppLinkCode()).toEqual({code:'123456',expiresAt:'2026-10-14T23:00:00Z'});
    expect(rpc).toHaveBeenCalledWith('request_whatsapp_link_code');
  });
  it('no muestra errores internos del servidor', async () => {
    rpc.mockResolvedValue({data:null,error:{message:'internal database detail'}});
    await expect(requestWhatsAppLinkCode()).rejects.toThrow('No pudimos generar el código');
  });
  it('acepta el código nuevo de vinculación', async () => {
    rpc.mockResolvedValue({ data:{code:'K7QM-X3RT-9PZD',expires_at:'2026-10-14T23:00:00Z'}, error:null });
    expect(await requestWhatsAppLinkCode()).toEqual({code:'K7QM-X3RT-9PZD',expiresAt:'2026-10-14T23:00:00Z'});
  });
  it.each([null,{}, {code:'bad',expires_at:'2026-10-14'}, {code:123456,expires_at:'2026-10-14'}, {code:'123456',expires_at:'invalid'}, {code:'K7QM-X3RT',expires_at:'2026-10-14'}, {code:'k7qm-x3rt-9pzd',expires_at:'2026-10-14'}, {code:'K7QM-X3RT-9PZ0',expires_at:'2026-10-14'}])('rechaza respuestas incompletas o inválidas: %j', async data => {
    rpc.mockResolvedValue({data,error:null});
    await expect(requestWhatsAppLinkCode()).rejects.toThrow('No recibimos un código');
  });
});

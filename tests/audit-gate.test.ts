import { describe, expect, it } from 'vitest';
import { evaluateAudit } from '../scripts/audit-gate.mjs';

// Reporte ficticio con la forma de `npm audit --json` (auditReportVersion 2).
const advisory = (name: string, ghsa: string, severity: string) => ({
  source: 1, name, dependency: name, title: `aviso de ${name}`, url: `https://github.com/advisories/${ghsa}`, severity, range: '<=1.0.0',
});
const report = (...roots: ReturnType<typeof advisory>[]) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries([
    ...roots.map((a) => [a.name, { name: a.name, severity: a.severity, via: [a] }]),
    // Dependiente transitivo: solo referencia por nombre, no es un aviso propio.
    ['vite', { name: 'vite', severity: 'high', via: roots.map((a) => a.name) }],
  ]),
});
const exception = { advisory: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', expires: '2026-12-18', reason: 'sin versión corregida' };
const today = new Date('2026-11-18T12:00:00Z');

describe('audit-gate: excepción acotada para npm audit', () => {
  it('deja pasar solo el aviso exceptuado y vigente', () => {
    const r = evaluateAudit(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')), [exception], today);
    expect(r.blocking).toEqual([]);
    expect(r.excepted.map((a) => a.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
  });

  it('cualquier otro aviso alto o crítico bloquea', () => {
    const r = evaluateAudit(report(
      advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high'),
      advisory('otro', 'GHSA-aaaa-bbbb-cccc', 'high'),
      advisory('grave', 'GHSA-dddd-eeee-ffff', 'critical'),
    ), [exception], today);
    expect(r.blocking.map((a) => a.id).sort()).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff']);
  });

  it('los avisos moderados o bajos no bloquean, como con --audit-level=high', () => {
    const r = evaluateAudit(report(advisory('leve', 'GHSA-1111-2222-3333', 'moderate'), advisory('menor', 'GHSA-4444-5555-6666', 'low')), [], today);
    expect(r.blocking).toEqual([]);
  });

  it('una excepción vencida vuelve a bloquear', () => {
    const r = evaluateAudit(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')), [exception], new Date('2026-12-19T03:00:01Z'));
    expect(r.blocking.map((a) => a.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(r.expired).toEqual(['GHSA-fc5q-39xc-vjpf']);
  });

  it('la excepción sigue vigente durante todo el día de vencimiento (hora argentina)', () => {
    const r = evaluateAudit(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')), [exception], new Date('2026-12-19T02:59:00Z'));
    expect(r.blocking).toEqual([]);
  });

  it('la excepción no se aplica al mismo aviso en otro paquete', () => {
    const r = evaluateAudit(report(advisory('otro-paquete', 'GHSA-fc5q-39xc-vjpf', 'high')), [exception], today);
    expect(r.blocking.map((a) => a.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
  });

  it('un reporte inválido falla en vez de aprobar', () => {
    expect(() => evaluateAudit({}, [exception], today)).toThrow();
    expect(() => evaluateAudit(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')), [{ ...exception, expires: 'pronto' }], today)).toThrow();
  });

  it('la configuración real solo exceptúa el aviso de picomatch y vence en 2026', async () => {
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(await readFile(new URL('../config/audit-exceptions.json', import.meta.url), 'utf8'));
    expect(config).toEqual([expect.objectContaining({ advisory: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', expires: '2026-12-18' })]);
  });
});

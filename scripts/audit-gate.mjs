// Barrera de dependencias del CI: equivale a `npm audit --audit-level=high`, pero admite excepciones
// acotadas (un aviso, un paquete, con vencimiento) aprobadas por el propietario en config/audit-exceptions.json.
// Un reporte o una excepción con formato inesperado falla: nunca se interpreta como "sin avisos".
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BLOCKING = new Set(['high', 'critical']);
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

// Fin del día de vencimiento en hora argentina (UTC−3, sin horario de verano).
function expiryEnd(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error(`AUDIT_EXCEPCION_FECHA_INVALIDA ${date}`);
  const end = Date.parse(`${date}T23:59:59.999-03:00`);
  if (!Number.isFinite(end)) throw new Error(`AUDIT_EXCEPCION_FECHA_INVALIDA ${date}`);
  return end;
}

export function evaluateAudit(report, exceptions, now = new Date()) {
  if (!report || typeof report !== 'object' || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error('AUDIT_REPORTE_INVALIDO');
  }
  if (!Array.isArray(exceptions)) throw new Error('AUDIT_EXCEPCIONES_INVALIDAS');
  for (const e of exceptions) {
    if (!GHSA.test(e?.advisory ?? '') || typeof e.package !== 'string' || !e.package || typeof e.reason !== 'string') {
      throw new Error('AUDIT_EXCEPCION_INVALIDA');
    }
    expiryEnd(e.expires);
  }
  // Avisos raíz: entradas `via` que son objetos (las cadenas son dependencias transitivas del mismo aviso).
  const seen = new Map();
  for (const vuln of Object.values(report.vulnerabilities)) {
    for (const via of vuln?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const id = String(via.url ?? '').split('/').pop();
      const key = `${id}|${via.name}`;
      if (!seen.has(key)) seen.set(key, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }
  const blocking = [], excepted = [], expired = [];
  for (const a of seen.values()) {
    if (!BLOCKING.has(a.severity)) continue;
    const match = exceptions.find((e) => e.advisory === a.id && e.package === a.package);
    if (!match) { blocking.push(a); continue; }
    if (now.getTime() > expiryEnd(match.expires)) { blocking.push(a); expired.push(a.id); continue; }
    excepted.push(a);
  }
  return { blocking, excepted, expired };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const exceptions = JSON.parse(readFileSync(resolve(root, 'config/audit-exceptions.json'), 'utf8'));
  let raw;
  try {
    // Comando fijo, sin datos externos; execSync usa la shell del sistema (necesaria para npm.cmd en Windows).
    raw = execSync('npm audit --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    raw = error.stdout; // npm audit sale con 1 cuando hay avisos; el JSON igual viene en stdout.
  }
  const result = evaluateAudit(JSON.parse(raw), exceptions);
  for (const a of result.excepted) console.log(`EXCEPTUADO ${a.id} (${a.package}, ${a.severity}): ${a.title}`);
  for (const id of result.expired) console.log(`EXCEPCIÓN VENCIDA ${id}: revisar config/audit-exceptions.json`);
  for (const a of result.blocking) console.log(`BLOQUEA ${a.id} (${a.package}, ${a.severity}): ${a.title}`);
  if (result.blocking.length) process.exit(1);
  console.log('Auditoría de dependencias: sin avisos altos o críticos fuera de las excepciones vigentes.');
}

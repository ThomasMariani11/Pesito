export type AuditFinding = { id: string; package: string; severity: string; title: string };
export type AuditException = { advisory: string; package: string; expires: string; reason: string };
export function evaluateAudit(
  report: unknown,
  exceptions: AuditException[],
  now?: Date,
): { blocking: AuditFinding[]; excepted: AuditFinding[]; expired: string[] };

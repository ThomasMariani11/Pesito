export function smokeInvitationContract(
  sql: (statement: string) => Promise<unknown>,
  options?: { transaction?: boolean },
): Promise<void>;

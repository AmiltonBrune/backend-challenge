export type AppRole = 'api' | 'consumer' | 'worker';

const knownRoles: readonly AppRole[] = ['api', 'consumer', 'worker'];

export function resolveAppRole(value: string | undefined): AppRole {
  if (value !== undefined && (knownRoles as readonly string[]).includes(value)) {
    return value as AppRole;
  }

  throw new Error(
    `APP_ROLE invalido: "${value ?? ''}". Valores aceitos: ${knownRoles.join(', ')}.`,
  );
}

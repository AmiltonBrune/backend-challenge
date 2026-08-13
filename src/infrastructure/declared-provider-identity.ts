import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';

export class DeclaredProviderIdentity implements ProviderIdentityPort {
  resolveProviderId(declaredProviderId: string): string {
    return declaredProviderId;
  }
}

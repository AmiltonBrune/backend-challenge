import { describe, expect, it } from 'bun:test';
import { DeclaredProviderIdentity } from '@infrastructure/declared-provider-identity.ts';

describe('DeclaredProviderIdentity', () => {
  it('retorna o providerId declarado sem verificação', () => {
    const identity = new DeclaredProviderIdentity();
    expect(identity.resolveProviderId('provider-a')).toBe('provider-a');
  });

  it('retorna exatamente qualquer valor declarado, mesmo arbitrário', () => {
    const identity = new DeclaredProviderIdentity();
    expect(identity.resolveProviderId('qualquer-coisa-nao-verificada')).toBe(
      'qualquer-coisa-nao-verificada',
    );
  });
});

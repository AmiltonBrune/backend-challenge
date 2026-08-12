import { describe, expect, it } from 'bun:test';
import { computePayloadHash } from '@domain/idempotency/payload-hash.ts';
import type { PayloadHashInput } from '@domain/idempotency/payload-hash-input.ts';

function baseInput(): PayloadHashInput {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
  };
}

describe('computePayloadHash — determinismo', () => {
  it('a mesma entrada produz sempre o mesmo hash', async () => {
    const input = baseInput();

    const first = await computePayloadHash(input);
    const second = await computePayloadHash(input);

    expect(first).toBe(second);
  });

  it('produz um digest SHA-256 em hexadecimal de 64 caracteres', async () => {
    const hash = await computePayloadHash(baseInput());

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computePayloadHash — ordem dos campos não importa', () => {
  it('campos reordenados no objeto de entrada produzem hash identico', async () => {
    const input = baseInput();
    const reordenado: PayloadHashInput = {
      kind: input.kind,
      walletId: input.walletId,
      providerId: input.providerId,
      roundId: input.roundId,
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      playerId: input.playerId,
      money: { currency: input.money.currency, amount: input.money.amount },
    };

    const hashOriginal = await computePayloadHash(input);
    const hashReordenado = await computePayloadHash(reordenado);

    expect(hashOriginal).toBe(hashReordenado);
  });
});

describe('computePayloadHash — sensibilidade a mudança de valor de negócio', () => {
  const campos: readonly [string, (input: PayloadHashInput) => PayloadHashInput][] = [
    ['providerId', (i) => ({ ...i, providerId: 'provider-b' })],
    ['externalTransactionId', (i) => ({ ...i, externalTransactionId: 'ext-2' })],
    ['playerId', (i) => ({ ...i, playerId: 'player-2' })],
    ['walletId', (i) => ({ ...i, walletId: 'wallet-2' })],
    ['roundId', (i) => ({ ...i, roundId: 'round-2' })],
    ['gameId', (i) => ({ ...i, gameId: 'game-2' })],
    ['kind', (i) => ({ ...i, kind: 'WIN' })],
    ['money.amount', (i) => ({ ...i, money: { ...i.money, amount: '26.00' } })],
    ['money.currency', (i) => ({ ...i, money: { ...i.money, currency: 'USD' } })],
    [
      'referenceExternalTransactionId',
      (i) => ({ ...i, referenceExternalTransactionId: 'ext-ref-1' }),
    ],
  ];

  for (const [campo, mutate] of campos) {
    it(`mudar ${campo} produz hash distinto`, async () => {
      const original = baseInput();
      const alterado = mutate(original);

      const hashOriginal = await computePayloadHash(original);
      const hashAlterado = await computePayloadHash(alterado);

      expect(hashOriginal).not.toBe(hashAlterado);
    });
  }
});

describe('computePayloadHash — referenceExternalTransactionId ausente', () => {
  it('ausente e presente-porem-igual-a-outro-valor produzem hashes diferentes entre si', async () => {
    const semReferencia = baseInput();
    const comReferencia: PayloadHashInput = {
      ...semReferencia,
      referenceExternalTransactionId: 'ext-ref-1',
    };

    expect(await computePayloadHash(semReferencia)).not.toBe(
      await computePayloadHash(comReferencia),
    );
  });

  it('omitir o campo e diferente de omiti-lo em outra chamada com valor identico presente', async () => {
    const a: PayloadHashInput = { ...baseInput(), referenceExternalTransactionId: 'ext-ref-1' };
    const b: PayloadHashInput = { ...baseInput(), referenceExternalTransactionId: 'ext-ref-1' };

    expect(await computePayloadHash(a)).toBe(await computePayloadHash(b));
  });
});

describe('computePayloadHash — metadados de transporte não influenciam', () => {
  it('propriedades extras fora do PayloadHashInput nao alteram o hash', async () => {
    const input = baseInput();
    const comMetadadosDeTransporte = {
      ...input,
      correlationId: 'corr-xyz',
      idempotencyKeyHeader: 'Idempotency-Key: abc',
      receivedAt: new Date().toISOString(),
    } as PayloadHashInput;

    expect(await computePayloadHash(comMetadadosDeTransporte)).toBe(
      await computePayloadHash(input),
    );
  });
});

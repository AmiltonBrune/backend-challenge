import { describe, expect, it } from 'bun:test';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { InvalidQueueMessageError } from '@workers/consumer/invalid-queue-message-error.ts';
import { parseWagerTransactionMessage } from '@workers/consumer/wager-transaction-message.ts';

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: 'provider-a:transaction-123',
    providerId: 'provider-a',
    externalTransactionId: 'transaction-123',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-987',
    gameId: 'fortune-chimp',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    referenceExternalTransactionId: null,
    ...overrides,
  };
}

describe('parseWagerTransactionMessage', () => {
  it('converte uma mensagem válida no input do caso de uso', () => {
    const input = parseWagerTransactionMessage(JSON.stringify(validBody()));

    expect(input).toEqual({
      declaredProviderId: 'provider-a',
      idempotencyKey: 'provider-a:transaction-123',
      externalTransactionId: 'transaction-123',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });
  });

  it('inclui referenceExternalTransactionId quando presente e não vazio', () => {
    const input = parseWagerTransactionMessage(
      JSON.stringify(validBody({ kind: 'REFUND', referenceExternalTransactionId: 'transaction-100' })),
    );

    expect(input.referenceExternalTransactionId).toBe('transaction-100');
  });

  it('rejeita JSON malformado', () => {
    expect(() => parseWagerTransactionMessage('{ isso não é json')).toThrow(InvalidQueueMessageError);
  });

  it('rejeita corpo que não é um objeto', () => {
    expect(() => parseWagerTransactionMessage('"uma string qualquer"')).toThrow(InvalidQueueMessageError);
    expect(() => parseWagerTransactionMessage('42')).toThrow(InvalidQueueMessageError);
    expect(() => parseWagerTransactionMessage('null')).toThrow(InvalidQueueMessageError);
  });

  it.each([
    'idempotencyKey',
    'providerId',
    'externalTransactionId',
    'playerId',
    'walletId',
    'roundId',
    'gameId',
  ])('rejeita quando o campo obrigatório %s está ausente', (field) => {
    const body = validBody();
    delete body[field];

    expect(() => parseWagerTransactionMessage(JSON.stringify(body))).toThrow(InvalidQueueMessageError);
  });

  it('rejeita quando um campo obrigatório é uma string vazia', () => {
    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(validBody({ playerId: '' }))),
    ).toThrow(InvalidQueueMessageError);
  });

  it('rejeita kind desconhecido', () => {
    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(validBody({ kind: 'ROUBO' }))),
    ).toThrow(InvalidQueueMessageError);
  });

  it('aceita kind OPENING sintaticamente — a rejeição de negócio é responsabilidade do caso de uso', () => {
    const input = parseWagerTransactionMessage(JSON.stringify(validBody({ kind: 'OPENING' })));

    expect(input.kind).toBe(WagerTransactionKind.OPENING);
  });

  it('rejeita money ausente ou malformado', () => {
    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(validBody({ money: undefined }))),
    ).toThrow(InvalidQueueMessageError);
    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(validBody({ money: { amount: '25.00' } }))),
    ).toThrow(InvalidQueueMessageError);
    expect(() =>
      parseWagerTransactionMessage(JSON.stringify(validBody({ money: '25.00' }))),
    ).toThrow(InvalidQueueMessageError);
  });

  it.each(['REFUND', 'ROLLBACK'])(
    'rejeita %s sem referenceExternalTransactionId',
    (kind) => {
      expect(() =>
        parseWagerTransactionMessage(JSON.stringify(validBody({ kind, referenceExternalTransactionId: null }))),
      ).toThrow(InvalidQueueMessageError);
    },
  );
});

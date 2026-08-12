import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InvalidTransactionStateError } from '@domain/errors/invalid-transaction-state-error.ts';

const money = (amount: string) => Money.from({ amount, currency: 'BRL' });
const createdAt = new Date('2026-08-12T00:00:00.000Z');
const processedAt = new Date('2026-08-12T00:01:00.000Z');

function baseProps(kind: WagerTransactionKind, referenceExternalTransactionId?: string) {
  return {
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'idem-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    kind,
    money: money('25.00'),
    ...(referenceExternalTransactionId !== undefined ? { referenceExternalTransactionId } : {}),
    createdAt,
  };
}

describe('WagerTransaction.create', () => {
  it('cria em PENDING', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    expect(tx.status()).toBe(WagerTransactionStatus.PENDING);
    expect(tx.isTerminal()).toBe(false);
  });

  it('lanca quando money nao e positivo', () => {
    expect(() =>
      WagerTransaction.create({ ...baseProps(WagerTransactionKind.BET), money: Money.zero('BRL') }),
    ).toThrow();
  });

  it('lanca quando REFUND nao informa referenceExternalTransactionId', () => {
    expect(() => WagerTransaction.create(baseProps(WagerTransactionKind.REFUND))).toThrow();
  });

  it('lanca quando ROLLBACK nao informa referenceExternalTransactionId', () => {
    expect(() => WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK))).toThrow();
  });

  it('aceita REFUND com referenceExternalTransactionId', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet-1'));

    expect(tx.referenceExternalTransactionId).toBe('tx-bet-1');
  });

  it('aceita WIN com referencia opcional', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.WIN, 'tx-bet-1'));

    expect(tx.referenceExternalTransactionId).toBe('tx-bet-1');
  });

  it('aceita BET sem referencia', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    expect(tx.referenceExternalTransactionId).toBeUndefined();
  });
});

describe('requiresReference', () => {
  it('verdadeiro apenas para REFUND e ROLLBACK', () => {
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'r')).requiresReference(),
    ).toBe(true);
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'r')).requiresReference(),
    ).toBe(true);
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.BET)).requiresReference()).toBe(
      false,
    );
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.WIN)).requiresReference()).toBe(
      false,
    );
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.LOSS)).requiresReference()).toBe(
      false,
    );
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.OPENING)).requiresReference(),
    ).toBe(false);
  });
});

describe('affectsBalance', () => {
  it('falso apenas para LOSS', () => {
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.LOSS)).affectsBalance()).toBe(
      false,
    );
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.BET)).affectsBalance()).toBe(
      true,
    );
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.WIN)).affectsBalance()).toBe(
      true,
    );
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.OPENING)).affectsBalance(),
    ).toBe(true);
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'r')).affectsBalance(),
    ).toBe(true);
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'r')).affectsBalance(),
    ).toBe(true);
  });
});

describe('ledgerDirectionFor', () => {
  it('OPENING, WIN e REFUND creditam', () => {
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.OPENING)).ledgerDirectionFor()).toBe(
      LedgerDirection.CREDIT,
    );
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.WIN)).ledgerDirectionFor()).toBe(
      LedgerDirection.CREDIT,
    );
    expect(
      WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'r')).ledgerDirectionFor(),
    ).toBe(LedgerDirection.CREDIT);
  });

  it('BET debita', () => {
    expect(WagerTransaction.create(baseProps(WagerTransactionKind.BET)).ledgerDirectionFor()).toBe(
      LedgerDirection.DEBIT,
    );
  });

  it('ROLLBACK inverte a direcao da referencia — de BET (debito) vira credito', () => {
    const bet = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    const rollback = WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'tx-bet'));

    expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.CREDIT);
  });

  it('ROLLBACK inverte a direcao da referencia — de WIN (credito) vira debito', () => {
    const win = WagerTransaction.create(baseProps(WagerTransactionKind.WIN));
    const rollback = WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'tx-win'));

    expect(rollback.ledgerDirectionFor(win)).toBe(LedgerDirection.DEBIT);
  });

  it('ROLLBACK inverte a direcao da referencia — de REFUND (credito) vira debito', () => {
    const refund = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet'));
    const rollback = WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'tx-refund'));

    expect(rollback.ledgerDirectionFor(refund)).toBe(LedgerDirection.DEBIT);
  });

  it('ROLLBACK sem referencia lanca', () => {
    const rollback = WagerTransaction.create(baseProps(WagerTransactionKind.ROLLBACK, 'tx-bet'));

    expect(() => rollback.ledgerDirectionFor()).toThrow();
  });

  it('LOSS lanca — nao possui direcao, affectsBalance ja e falso', () => {
    const loss = WagerTransaction.create(baseProps(WagerTransactionKind.LOSS));

    expect(() => loss.ledgerDirectionFor()).toThrow();
  });
});

describe('matchesPayload', () => {
  it('compara o hash informado ao payloadHash armazenado', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    expect(tx.matchesPayload('hash-1')).toBe(true);
    expect(tx.matchesPayload('outro-hash')).toBe(false);
  });
});

describe('markProcessed', () => {
  it('transiciona PENDING -> PROCESSED e grava referenceTransactionId e processedAt', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    tx.markProcessed('ref-tx-1', processedAt);

    expect(tx.status()).toBe(WagerTransactionStatus.PROCESSED);
    expect(tx.referenceTransactionId()).toBe('ref-tx-1');
    expect(tx.processedAt()?.toISOString()).toBe(processedAt.toISOString());
    expect(tx.isTerminal()).toBe(true);
  });

  it('transiciona PENDING_REFERENCE -> PROCESSED', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet'));
    tx.markPendingReference();

    tx.markProcessed('ref-tx-1', processedAt);

    expect(tx.status()).toBe(WagerTransactionStatus.PROCESSED);
  });

  it('lanca InvalidTransactionStateError a partir de estado terminal', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    tx.markProcessed(undefined, processedAt);

    expect(() => tx.markProcessed(undefined, processedAt)).toThrow(InvalidTransactionStateError);
  });
});

describe('markPendingReference', () => {
  it('transiciona PENDING -> PENDING_REFERENCE', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet'));

    tx.markPendingReference();

    expect(tx.status()).toBe(WagerTransactionStatus.PENDING_REFERENCE);
    expect(tx.isTerminal()).toBe(false);
  });

  it('lanca ao chamar novamente a partir de PENDING_REFERENCE', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet'));
    tx.markPendingReference();

    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });

  it('lanca a partir de estado terminal', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    tx.reject(FailureCode.INSUFFICIENT_FUNDS);

    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });
});

describe('reject', () => {
  it('transiciona PENDING -> REJECTED com failureCode', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    tx.reject(FailureCode.INSUFFICIENT_FUNDS);

    expect(tx.status()).toBe(WagerTransactionStatus.REJECTED);
    expect(tx.failureCode()).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(tx.isTerminal()).toBe(true);
  });

  it('transiciona PENDING_REFERENCE -> REJECTED', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'tx-bet'));
    tx.markPendingReference();

    tx.reject(FailureCode.REFERENCE_NOT_FOUND);

    expect(tx.status()).toBe(WagerTransactionStatus.REJECTED);
  });

  it('lanca a partir de estado terminal', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    tx.reject(FailureCode.INSUFFICIENT_FUNDS);

    expect(() => tx.reject(FailureCode.INSUFFICIENT_FUNDS)).toThrow(InvalidTransactionStateError);
  });
});

describe('fail', () => {
  it('transiciona PENDING -> FAILED com failureCode', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    tx.fail(FailureCode.WALLET_NOT_FOUND);

    expect(tx.status()).toBe(WagerTransactionStatus.FAILED);
    expect(tx.failureCode()).toBe(FailureCode.WALLET_NOT_FOUND);
    expect(tx.isTerminal()).toBe(true);
  });

  it('lanca a partir de estado terminal', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    tx.fail(FailureCode.WALLET_NOT_FOUND);

    expect(() => tx.fail(FailureCode.WALLET_NOT_FOUND)).toThrow(InvalidTransactionStateError);
  });
});

describe('isTerminal', () => {
  it('verdadeiro somente para PROCESSED, REJECTED e FAILED', () => {
    const pending = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    expect(pending.isTerminal()).toBe(false);

    const pendingRef = WagerTransaction.create(baseProps(WagerTransactionKind.REFUND, 'r'));
    pendingRef.markPendingReference();
    expect(pendingRef.isTerminal()).toBe(false);

    const processed = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    processed.markProcessed(undefined, processedAt);
    expect(processed.isTerminal()).toBe(true);

    const rejected = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    rejected.reject(FailureCode.INSUFFICIENT_FUNDS);
    expect(rejected.isTerminal()).toBe(true);

    const failed = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    failed.fail(FailureCode.WALLET_NOT_FOUND);
    expect(failed.isTerminal()).toBe(true);
  });
});

describe('createdAt e processedAt — imutabilidade', () => {
  it('mutar a Date original de createdAt nao afeta a entidade', () => {
    const inputDate = new Date('2026-08-12T00:00:00.000Z');
    const tx = WagerTransaction.create({ ...baseProps(WagerTransactionKind.BET), createdAt: inputDate });

    inputDate.setFullYear(1999);

    expect(tx.createdAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('mutar o retorno de createdAt nao afeta a entidade', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));

    tx.createdAt.setFullYear(1999);

    expect(tx.createdAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('mutar o retorno de processedAt nao afeta a entidade', () => {
    const tx = WagerTransaction.create(baseProps(WagerTransactionKind.BET));
    tx.markProcessed(undefined, processedAt);

    tx.processedAt()?.setFullYear(1999);

    expect(tx.processedAt()?.toISOString()).toBe(processedAt.toISOString());
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('reconstroi sem revalidar — REFUND sem referencia nao lanca', () => {
    expect(() =>
      WagerTransaction.rehydrate({
        ...baseProps(WagerTransactionKind.REFUND),
        status: WagerTransactionStatus.PROCESSED,
        processedAt,
      }),
    ).not.toThrow();
  });

  it('reconstroi o estado exatamente como informado', () => {
    const tx = WagerTransaction.rehydrate({
      ...baseProps(WagerTransactionKind.BET),
      status: WagerTransactionStatus.REJECTED,
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
    });

    expect(tx.status()).toBe(WagerTransactionStatus.REJECTED);
    expect(tx.failureCode()).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(tx.isTerminal()).toBe(true);
  });
});

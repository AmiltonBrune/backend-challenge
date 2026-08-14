import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { ConcurrentIdempotencyProcessingError } from '@application/errors/concurrent-idempotency-processing-error.ts';
import { IdempotencyPayloadConflictError } from '@application/errors/idempotency-payload-conflict-error.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { computePayloadHash } from '@domain/idempotency/payload-hash.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

class DeclaredIdentity implements ProviderIdentityPort {
  resolveProviderId(declared: string): string {
    return declared;
  }
}

let AppDataSource: DataSource | undefined;
let useCase: ProcessWagerTransactionUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function processWager(): ProcessWagerTransactionUseCase {
  if (useCase === undefined) {
    throw new Error('ProcessWagerTransactionUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

async function insertWallet(balance: string): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'BRL', $2, 1, now(), now())
     RETURNING id`,
    [playerId, balance],
  );
  return { id: (rows as { id: string }[])[0]!.id, playerId };
}

describeIfDocker('ProcessWagerTransactionUseCase — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts'
    );
    const { TypeOrmWagerTransactionRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    const { UuidIdGenerator } = await import('@infrastructure/uuid-id-generator.ts');
    const { ProcessWagerTransactionUseCase } = await import(
      '@application/use-cases/process-wager-transaction-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const clock = new FixedClock();
    useCase = new ProcessWagerTransactionUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWalletRepository(clock),
      new TypeOrmWagerTransactionRepository(),
      new TypeOrmLedgerRepository(),
      new TypeOrmOutboxRepository(),
      new DeclaredIdentity(),
      clock,
      new UuidIdGenerator(),
    );
  }, 60_000);

  afterAll(async () => {
    try {
      if (AppDataSource?.isInitialized === true) {
        await AppDataSource.destroy();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it('BET com saldo suficiente debita a wallet e persiste tudo atomicamente', async () => {
    const wallet = await insertWallet('100.00');

    const result = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('75.00');

    const walletRows = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE id = $1`,
      [wallet.id],
    );
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('75.00');

    const txRows = await dataSource().query(
      `SELECT status, game_id FROM wager_transactions WHERE id = $1`,
      [result.transactionId],
    );
    expect((txRows as { status: string; game_id: string }[])[0]).toEqual({
      status: 'PROCESSED',
      game_id: 'game-1',
    });

    const ledgerRows = await dataSource().query(
      `SELECT direction FROM wallet_ledger_entries WHERE transaction_id = $1`,
      [result.transactionId],
    );
    expect((ledgerRows as { direction: string }[])[0]?.direction).toBe('DEBIT');

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY occurred_at`,
      [result.transactionId],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WagerTransactionProcessed',
    ]);

    const walletEventRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
      [wallet.id],
    );
    expect((walletEventRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WalletBalanceChanged',
    ]);
  });

  it('BET sem saldo suficiente rejeita, commita a rejeição e não move a wallet', async () => {
    const wallet = await insertWallet('10.00');

    const result = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

    const txRows = await dataSource().query(
      `SELECT status, failure_code FROM wager_transactions WHERE id = $1`,
      [result.transactionId],
    );
    expect((txRows as { status: string; failure_code: string }[])[0]).toEqual({
      status: 'REJECTED',
      failure_code: 'INSUFFICIENT_FUNDS',
    });

    const walletRows = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE id = $1`,
      [wallet.id],
    );
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('10.00');

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
      [result.transactionId],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WagerTransactionRejected',
    ]);
  });

  it('LOSS processa sem mover saldo nem gerar lançamento', async () => {
    const wallet = await insertWallet('100.00');

    const result = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.LOSS,
      money: { amount: '25.00', currency: 'BRL' },
    });

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('100.00');

    const ledgerRows = await dataSource().query(
      `SELECT 1 FROM wallet_ledger_entries WHERE transaction_id = $1`,
      [result.transactionId],
    );
    expect(ledgerRows).toHaveLength(0);

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
      [wallet.id],
    );
    expect(outboxRows).toHaveLength(0);
  });

  it('idempotencyKey duplicada com externalTransactionId diferente é conflito de payload, sem segunda transação', async () => {
    const wallet = await insertWallet('100.00');
    const idempotencyKey = crypto.randomUUID();

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey,
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '10.00', currency: 'BRL' },
    });

    await expect(
      processWager().execute({
        declaredProviderId: 'provider-a',
        idempotencyKey,
        externalTransactionId: crypto.randomUUID(),
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money: { amount: '10.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(IdempotencyPayloadConflictError);

    const walletRows = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE id = $1`,
      [wallet.id],
    );
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('90.00');

    const txRows = await dataSource().query(
      `SELECT 1 FROM wager_transactions WHERE wallet_id = $1`,
      [wallet.id],
    );
    expect(txRows).toHaveLength(1);
  });

  it('reenvio com o payload idêntico é replay idempotente e devolve o saldo histórico da operação original', async () => {
    const wallet = await insertWallet('100.00');
    const idempotencyKey = crypto.randomUUID();
    const externalTransactionId = crypto.randomUUID();
    const original = {
      declaredProviderId: 'provider-a',
      idempotencyKey,
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    };

    const first = await processWager().execute(original);
    expect(first.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(first.balance?.amount).toBe('75.00');
    expect(first.idempotentReplay).toBe(false);

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.WIN,
      money: { amount: '50.00', currency: 'BRL' },
    });

    const replay = await processWager().execute(original);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.balance?.amount).toBe('75.00');

    const txRows = await dataSource().query(
      `SELECT 1 FROM wager_transactions WHERE wallet_id = $1 AND kind = 'BET'`,
      [wallet.id],
    );
    expect(txRows).toHaveLength(1);
  });

  it('lança ConcurrentIdempotencyProcessingError quando a transação existente ainda está PENDING', async () => {
    const wallet = await insertWallet('100.00');
    const idempotencyKey = crypto.randomUUID();
    const externalTransactionId = crypto.randomUUID();
    const money = { amount: '25.00', currency: 'BRL' };

    const payloadHash = await computePayloadHash({
      providerId: 'provider-a',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money,
    });

    await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
       VALUES (gen_random_uuid(), 'provider-a', $1, $2, $3, $4, $5, 'round-1', 'game-1', 'BET', '25.00', 'BRL', 'PENDING', now())`,
      [externalTransactionId, idempotencyKey, payloadHash, wallet.id, wallet.playerId],
    );

    await expect(
      processWager().execute({
        declaredProviderId: 'provider-a',
        idempotencyKey,
        externalTransactionId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money,
      }),
    ).rejects.toThrow(ConcurrentIdempotencyProcessingError);
  });

  it('REFUND credita de volta um BET processado e resolve reference_transaction_id', async () => {
    const wallet = await insertWallet('100.00');
    const betExternalId = crypto.randomUUID();

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });

    const refund = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });

    expect(refund.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(refund.balance?.amount).toBe('100.00');

    const txRows = await dataSource().query(
      `SELECT reference_transaction_id FROM wager_transactions WHERE id = $1`,
      [refund.transactionId],
    );
    expect((txRows as { reference_transaction_id: string | null }[])[0]?.reference_transaction_id).not.toBeNull();
  });

  it('retorna PENDING_REFERENCE quando a referência ainda não chegou', async () => {
    const wallet = await insertWallet('100.00');

    const result = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: crypto.randomUUID(),
    });

    expect(result.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

    const txRows = await dataSource().query(
      `SELECT status FROM wager_transactions WHERE id = $1`,
      [result.transactionId],
    );
    expect((txRows as { status: string }[])[0]?.status).toBe('PENDING_REFERENCE');

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
      [result.transactionId],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WagerTransactionPendingReference',
    ]);
  });

  it('ROLLBACK de um WIN já consumido rejeita com REVERSAL_WOULD_OVERDRAW', async () => {
    const wallet = await insertWallet('0.00');
    const winExternalId = crypto.randomUUID();

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: winExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.WIN,
      money: { amount: '50.00', currency: 'BRL' },
    });

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '50.00', currency: 'BRL' },
    });

    const rollback = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.ROLLBACK,
      money: { amount: '50.00', currency: 'BRL' },
      referenceExternalTransactionId: winExternalId,
    });

    expect(rollback.status).toBe(WagerTransactionStatus.REJECTED);
    expect(rollback.failureCode).toBe(FailureCode.REVERSAL_WOULD_OVERDRAW);

    const walletRows = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE id = $1`,
      [wallet.id],
    );
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('0.00');
  });

  it('uma segunda tentativa de REFUND para a mesma referência é rejeitada com REFERENCE_ALREADY_REVERSED', async () => {
    const wallet = await insertWallet('100.00');
    const betExternalId = crypto.randomUUID();

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });

    await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });

    const secondRefund = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });

    expect(secondRefund.status).toBe(WagerTransactionStatus.REJECTED);
    expect(secondRefund.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
  });
});

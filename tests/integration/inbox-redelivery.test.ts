import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';

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
let unitOfWork: UnitOfWork | undefined;
let walletRepository: WalletRepository | undefined;
let ledgerRepository: LedgerRepository | undefined;
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

describeIfDocker('T-059 — inbox e redelivery via ProcessWagerTransactionUseCase real', () => {
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
    const { TypeOrmInboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-inbox-repository.ts'
    );
    const { UuidIdGenerator } = await import('@infrastructure/uuid-id-generator.ts');

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const clock = new FixedClock();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    walletRepository = new TypeOrmWalletRepository(clock);
    ledgerRepository = new TypeOrmLedgerRepository();
    useCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      walletRepository,
      new TypeOrmWagerTransactionRepository(),
      ledgerRepository,
      new TypeOrmOutboxRepository(),
      new TypeOrmInboxRepository(clock),
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

  it('a mesma redelivery de SQS (mesmo messageId) não duplica saldo, ledger nem eventos na outbox', async () => {
    const wallet = await insertWallet('100.00');
    const dedup = { messageId: crypto.randomUUID(), consumerName: 'wagering-consumer' };
    const input = {
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '30.00', currency: 'BRL' },
    };

    const first = await processWager().execute(input, dedup);
    if ('duplicateMessage' in first) {
      throw new Error('primeira entrega não deveria ser tratada como duplicata');
    }
    expect(first.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(first.balance?.amount).toBe('70.00');

    const afterFirst = {
      wallet: await dataSource().query(`SELECT balance_amount FROM wallets WHERE id = $1`, [wallet.id]),
      ledger: await dataSource().query(
        `SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id = $1`,
        [wallet.id],
      ),
      transactions: await dataSource().query(
        `SELECT count(*)::int AS c FROM wager_transactions WHERE wallet_id = $1`,
        [wallet.id],
      ),
      outbox: await dataSource().query(
        `SELECT count(*)::int AS c FROM outbox_messages WHERE aggregate_id IN ($1, $2)`,
        [first.transactionId, wallet.id],
      ),
      inbox: await dataSource().query(
        `SELECT count(*)::int AS c FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
        [dedup.consumerName, dedup.messageId],
      ),
    };
    expect((afterFirst.wallet as { balance_amount: string }[])[0]?.balance_amount).toBe('70.00');
    expect((afterFirst.ledger as { c: number }[])[0]?.c).toBe(1);
    expect((afterFirst.transactions as { c: number }[])[0]?.c).toBe(1);
    expect((afterFirst.outbox as { c: number }[])[0]?.c).toBe(2);
    expect((afterFirst.inbox as { c: number }[])[0]?.c).toBe(1);

    const redelivery = await processWager().execute(input, dedup);
    expect(redelivery).toEqual({ duplicateMessage: true });

    const afterRedelivery = {
      wallet: await dataSource().query(`SELECT balance_amount FROM wallets WHERE id = $1`, [wallet.id]),
      ledger: await dataSource().query(
        `SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id = $1`,
        [wallet.id],
      ),
      transactions: await dataSource().query(
        `SELECT count(*)::int AS c FROM wager_transactions WHERE wallet_id = $1`,
        [wallet.id],
      ),
      outbox: await dataSource().query(
        `SELECT count(*)::int AS c FROM outbox_messages WHERE aggregate_id IN ($1, $2)`,
        [first.transactionId, wallet.id],
      ),
      inbox: await dataSource().query(
        `SELECT count(*)::int AS c FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
        [dedup.consumerName, dedup.messageId],
      ),
    };
    expect((afterRedelivery.wallet as { balance_amount: string }[])[0]?.balance_amount).toBe('70.00');
    expect((afterRedelivery.ledger as { c: number }[])[0]?.c).toBe(1);
    expect((afterRedelivery.transactions as { c: number }[])[0]?.c).toBe(1);
    expect((afterRedelivery.outbox as { c: number }[])[0]?.c).toBe(2);
    expect((afterRedelivery.inbox as { c: number }[])[0]?.c).toBe(1);
  });

  it('redeliveries repetidas (3x) da mesma mensagem continuam sem efeito colateral adicional', async () => {
    const wallet = await insertWallet('50.00');
    const dedup = { messageId: crypto.randomUUID(), consumerName: 'wagering-consumer' };
    const input = {
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '20.00', currency: 'BRL' },
    };

    await processWager().execute(input, dedup);
    await processWager().execute(input, dedup);
    const third = await processWager().execute(input, dedup);
    expect(third).toEqual({ duplicateMessage: true });

    const walletRows = await dataSource().query(`SELECT balance_amount FROM wallets WHERE id = $1`, [
      wallet.id,
    ]);
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('30.00');

    const ledgerRows = await dataSource().query(
      `SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id = $1`,
      [wallet.id],
    );
    expect((ledgerRows as { c: number }[])[0]?.c).toBe(1);
  });
});

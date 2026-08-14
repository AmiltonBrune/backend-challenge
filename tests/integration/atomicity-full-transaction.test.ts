import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import { OpenWalletUseCase } from '@application/use-cases/open-wallet-use-case.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
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

class BreaksOnFirstInsertOutboxRepository implements OutboxRepository {
  private insertCalls = 0;

  constructor(private readonly delegate: OutboxRepository) {}

  insert(ctx: TransactionContext, message: OutboxMessage): Promise<void> {
    this.insertCalls += 1;
    if (this.insertCalls === 1) {
      throw new Error('falha forçada de teste — outbox.insert quebrado propositalmente');
    }
    return this.delegate.insert(ctx, message);
  }

  reservePending(
    ctx: TransactionContext,
    limit: number,
    now: Date,
  ): Promise<readonly OutboxMessage[]> {
    return this.delegate.reservePending(ctx, limit, now);
  }

  update(ctx: TransactionContext, message: OutboxMessage): Promise<void> {
    return this.delegate.update(ctx, message);
  }
}

let AppDataSource: DataSource | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

async function countAllTables(): Promise<Record<string, number>> {
  const tables = [
    'wallets',
    'wager_transactions',
    'wallet_ledger_entries',
    'inbox_messages',
    'outbox_messages',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await dataSource().query(`SELECT count(*)::int AS c FROM ${table}`);
    counts[table] = (rows as { c: number }[])[0]!.c;
  }
  return counts;
}

describeIfDocker('T-058 — atomicidade entre wallet, ledger, transação, inbox e outbox', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
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

  it('quando o outbox falha no meio do commit, nenhuma escrita da unidade de trabalho persiste', async () => {
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

    const clock = new FixedClock();
    const unitOfWork: UnitOfWork = new TypeOrmUnitOfWork(dataSource());
    const walletRepository = new TypeOrmWalletRepository(clock);
    const wagerTransactionRepository = new TypeOrmWagerTransactionRepository();
    const ledgerRepository = new TypeOrmLedgerRepository();
    const idGenerator = new UuidIdGenerator();

    const { wallet } = await new OpenWalletUseCase(
      unitOfWork,
      walletRepository,
      wagerTransactionRepository,
      ledgerRepository,
      new TypeOrmOutboxRepository(),
      clock,
      idGenerator,
    ).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } });

    const brokenOutboxRepository = new BreaksOnFirstInsertOutboxRepository(new TypeOrmOutboxRepository());

    const useCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      walletRepository,
      wagerTransactionRepository,
      ledgerRepository,
      brokenOutboxRepository,
      new TypeOrmInboxRepository(clock),
      new DeclaredIdentity(),
      clock,
      idGenerator,
    );

    const before = await countAllTables();
    const dedup = { messageId: crypto.randomUUID(), consumerName: 'wagering-consumer' };

    await expect(
      useCase.execute(
        {
          declaredProviderId: 'provider-a',
          idempotencyKey: crypto.randomUUID(),
          externalTransactionId: crypto.randomUUID(),
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.BET,
          money: { amount: '25.00', currency: 'BRL' },
        },
        dedup,
      ),
    ).rejects.toThrow('falha forçada de teste — outbox.insert quebrado propositalmente');

    const after = await countAllTables();
    expect(after).toEqual(before);

    const walletRows = await dataSource().query(
      `SELECT balance_amount, version FROM wallets WHERE id = $1`,
      [wallet.id],
    );
    expect((walletRows as { balance_amount: string; version: number }[])[0]).toEqual({
      balance_amount: '100.00',
      version: 1,
    });

    const inboxRows = await dataSource().query(
      `SELECT 1 FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
      [dedup.consumerName, dedup.messageId],
    );
    expect(inboxRows).toHaveLength(0);

    const reconciliation = await new ReconcileWalletUseCase(
      unitOfWork,
      walletRepository,
      ledgerRepository,
    ).execute({ walletId: wallet.id });
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe('100.00');
  });
});

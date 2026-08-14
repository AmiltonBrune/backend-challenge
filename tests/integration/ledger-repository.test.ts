import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let AppDataSource: DataSource | undefined;
let unitOfWork: UnitOfWork | undefined;
let repository: LedgerRepository | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function uow(): UnitOfWork {
  if (unitOfWork === undefined) {
    throw new Error('UnitOfWork não inicializado — beforeAll falhou');
  }
  return unitOfWork;
}

function repo(): LedgerRepository {
  if (repository === undefined) {
    throw new Error('LedgerRepository não inicializado — beforeAll falhou');
  }
  return repository;
}

async function insertWallet(): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'BRL', 0.00, 1, now(), now())
     RETURNING id`,
    [playerId],
  );
  return { id: (rows as { id: string }[])[0]!.id, playerId };
}

async function insertWagerTransaction(
  walletId: string,
  playerId: string,
  kind: string,
): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wager_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
     VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', $5, '1.00', 'BRL', 'PROCESSED', now())
     RETURNING id`,
    [crypto.randomUUID(), crypto.randomUUID(), walletId, playerId, kind],
  );
  return (rows as { id: string }[])[0]!.id;
}

describeIfDocker('TypeOrmLedgerRepository — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    repository = new TypeOrmLedgerRepository();
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

  it('insere e recarrega um lançamento com os mesmos dados', async () => {
    const wallet = await insertWallet();
    const transactionId = await insertWagerTransaction(wallet.id, wallet.playerId, 'OPENING');
    const entry = WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId: wallet.id,
      transactionId,
      direction: LedgerDirection.CREDIT,
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    await uow().run((ctx) => repo().insert(ctx, entry));

    const found = await uow().run((ctx) => repo().findByTransactionId(ctx, transactionId));
    expect(found?.id).toBe(entry.id);
    expect(found?.direction).toBe(LedgerDirection.CREDIT);
    expect(found?.money.toJSON().amount).toBe('100.00');
    expect(found?.balanceBefore.toJSON().amount).toBe('0.00');
    expect(found?.balanceAfter.toJSON().amount).toBe('100.00');
  });

  it('retorna undefined para uma transactionId sem lançamento', async () => {
    const found = await uow().run((ctx) => repo().findByTransactionId(ctx, crypto.randomUUID()));
    expect(found).toBeUndefined();
  });

  it('agrega CREDIT menos DEBIT por wallet para reconciliação', async () => {
    const wallet = await insertWallet();

    const openingTxId = await insertWagerTransaction(wallet.id, wallet.playerId, 'OPENING');
    const betTxId = await insertWagerTransaction(wallet.id, wallet.playerId, 'BET');
    const winTxId = await insertWagerTransaction(wallet.id, wallet.playerId, 'WIN');

    await uow().run(async (ctx) => {
      await repo().insert(
        ctx,
        WalletLedgerEntry.create({
          id: crypto.randomUUID(),
          walletId: wallet.id,
          transactionId: openingTxId,
          direction: LedgerDirection.CREDIT,
          money: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceBefore: Money.zero('BRL'),
          balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
          createdAt: new Date(),
        }),
      );
      await repo().insert(
        ctx,
        WalletLedgerEntry.create({
          id: crypto.randomUUID(),
          walletId: wallet.id,
          transactionId: betTxId,
          direction: LedgerDirection.DEBIT,
          money: Money.from({ amount: '30.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
          createdAt: new Date(),
        }),
      );
      await repo().insert(
        ctx,
        WalletLedgerEntry.create({
          id: crypto.randomUUID(),
          walletId: wallet.id,
          transactionId: winTxId,
          direction: LedgerDirection.CREDIT,
          money: Money.from({ amount: '10.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '70.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '80.00', currency: 'BRL' }),
          createdAt: new Date(),
        }),
      );
    });

    const net = await uow().run((ctx) => repo().sumByWalletId(ctx, wallet.id, 'BRL'));
    expect(net.toJSON().amount).toBe('80.00');
    expect(net.toJSON().currency).toBe('BRL');
  });

  it('retorna Money.zero(currency) para uma wallet aberta sem nenhum lançamento', async () => {
    const wallet = await insertWallet();
    const net = await uow().run((ctx) => repo().sumByWalletId(ctx, wallet.id, 'BRL'));

    expect(net.isZero()).toBe(true);
    expect(net.toJSON().amount).toBe('0.00');
    expect(net.toJSON().currency).toBe('BRL');
  });

  it('retorna um total negativo quando débitos superam créditos, em vez de lançar', async () => {
    const wallet = await insertWallet();
    const txId = await insertWagerTransaction(wallet.id, wallet.playerId, 'BET');
    await dataSource().query(
      `INSERT INTO wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, money_amount,
          balance_before_amount, balance_after_amount, currency, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'DEBIT', '30.00', '50.00', '20.00', 'BRL', now())`,
      [wallet.id, txId],
    );

    const net = await uow().run((ctx) => repo().sumByWalletId(ctx, wallet.id, 'BRL'));
    expect(net.isNegative()).toBe(true);
    expect(net.toJSON().amount).toBe('-30.00');
  });
});

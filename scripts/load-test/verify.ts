const baseUrl = process.env['LOAD_TEST_BASE_URL'] ?? 'http://localhost:3000';

interface SeedOutput {
  readonly distributed: { readonly walletId: string }[];
  readonly hotWallet: { readonly walletId: string };
  readonly replayWallet: { readonly walletId: string };
}

async function reconcile(walletId: string): Promise<{ consistent: boolean }> {
  const response = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`reconciliação falhou para ${walletId}: ${response.status}`);
  }
  return (await response.json()) as { consistent: boolean };
}

async function main(): Promise<void> {
  const raw = await Bun.file('load/seed-output.json').text();
  const seed = JSON.parse(raw) as SeedOutput;

  const walletIds = [
    ...seed.distributed.map((wallet) => wallet.walletId),
    seed.hotWallet.walletId,
    seed.replayWallet.walletId,
  ];

  let consistent = 0;
  let inconsistent = 0;
  const inconsistentIds: string[] = [];

  for (const walletId of walletIds) {
    const result = await reconcile(walletId);
    if (result.consistent) {
      consistent += 1;
    } else {
      inconsistent += 1;
      inconsistentIds.push(walletId);
    }
  }

  console.log(`reconciliação: ${consistent} consistentes, ${inconsistent} inconsistentes`);
  if (inconsistent > 0) {
    console.error('wallets inconsistentes:', inconsistentIds);
    process.exit(1);
  }

  const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
  await AppDataSource.initialize();

  const pendingTransactions = await AppDataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM wager_transactions WHERE status = 'PENDING'`,
  );
  const pendingCount = Number(pendingTransactions[0]?.count ?? '0');
  console.log(`transações em PENDING (nunca deveriam existir fora de uma transação em voo): ${pendingCount}`);

  const pendingReferenceTransactions = await AppDataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM wager_transactions WHERE status = 'PENDING_REFERENCE'`,
  );
  console.log(
    `transações em PENDING_REFERENCE (esperado 0 nesta carga, já que nenhuma referência é enviada antes da operação original): ${pendingReferenceTransactions[0]?.count ?? '0'}`,
  );

  const unpublishedOutbox = await AppDataSource.query<{ count: string }[]>(
    `SELECT count(*) FROM outbox_messages WHERE published_at IS NULL`,
  );
  console.log(`mensagens outbox ainda não publicadas: ${unpublishedOutbox[0]?.count ?? '0'}`);

  await AppDataSource.destroy();

  if (pendingCount > 0) {
    console.error('há transações presas em PENDING — isso indica um bug de atomicidade.');
    process.exit(1);
  }

  console.log('verificação pós-carga concluída sem divergências.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

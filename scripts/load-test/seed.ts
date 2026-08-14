const baseUrl = process.env['LOAD_TEST_BASE_URL'] ?? 'http://localhost:3000';

const DISTRIBUTED_WALLET_COUNT = 50;
const DISTRIBUTED_INITIAL_BALANCE = '1000000.00';
const HOT_WALLET_INITIAL_BALANCE = '5000000.00';
const REPLAY_WALLET_INITIAL_BALANCE = '1000.00';

interface SeededWallet {
  readonly walletId: string;
  readonly playerId: string;
}

async function openWallet(initialBalance: string): Promise<SeededWallet> {
  const playerId = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: initialBalance, currency: 'BRL' } }),
  });
  if (!response.ok) {
    throw new Error(`falha ao abrir wallet: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string };
  return { walletId: body.id, playerId };
}

async function main(): Promise<void> {
  console.log(`semeando carga contra ${baseUrl}`);

  const distributed: SeededWallet[] = [];
  for (let index = 0; index < DISTRIBUTED_WALLET_COUNT; index += 1) {
    distributed.push(await openWallet(DISTRIBUTED_INITIAL_BALANCE));
  }

  const hotWallet = await openWallet(HOT_WALLET_INITIAL_BALANCE);
  const replayWallet = await openWallet(REPLAY_WALLET_INITIAL_BALANCE);

  const output = { distributed, hotWallet, replayWallet };
  await Bun.write('load/seed-output.json', JSON.stringify(output, null, 2));

  console.log(
    `seed concluído: ${distributed.length} wallets distribuídas, 1 hot wallet, 1 wallet de replay`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

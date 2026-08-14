import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || 'http://localhost:3000';

const seed = JSON.parse(open('./seed-output.json'));

const distributedWallets = new SharedArray('distributed', () => seed.distributed);
const hotWallet = seed.hotWallet;
const replayWallet = seed.replayWallet;

export const insufficientFundsCounter = new Counter('wagering_insufficient_funds_total');
export const unexpectedErrorCounter = new Counter('wagering_unexpected_errors_total');
export const processedCounter = new Counter('wagering_processed_total');
export const replayCounter = new Counter('wagering_idempotent_replay_total');

export const options = {
  scenarios: {
    distributed: {
      executor: 'constant-vus',
      vus: 15,
      duration: '20s',
      exec: 'distributed',
    },
    hot_wallet: {
      executor: 'constant-vus',
      vus: 10,
      duration: '20s',
      exec: 'hotWalletScenario',
      startTime: '20s',
    },
    replay: {
      executor: 'constant-vus',
      vus: 5,
      duration: '15s',
      exec: 'replayScenario',
      startTime: '40s',
    },
  },
};

function postWager(body, idempotencyKey) {
  return http.post(`${BASE_URL}/wagering/transactions`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  });
}

function walletForVU() {
  return distributedWallets[__VU % distributedWallets.length];
}

const lastBetByVU = {};

export function distributed() {
  const wallet = walletForVU();
  const roll = Math.random();
  const externalTransactionId = `dist-${__VU}-${__ITER}-${Date.now()}`;
  const idempotencyKey = `provider-load:${externalTransactionId}`;
  const previousBet = lastBetByVU[__VU];

  let kind = 'BET';
  if (roll < 0.5) {
    kind = 'BET';
  } else if (roll < 0.75) {
    kind = 'LOSS';
  } else if (roll < 0.95) {
    kind = 'WIN';
  } else if (previousBet !== undefined) {
    kind = 'REFUND';
  } else {
    kind = 'BET';
  }

  const roundId = kind === 'REFUND' && previousBet !== undefined ? previousBet.roundId : `round-${__VU}-${__ITER}`;

  const body = {
    providerId: 'provider-load',
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.walletId,
    roundId,
    gameId: 'load-test-game',
    kind,
    money: { amount: '5.00', currency: 'BRL' },
  };
  if (kind === 'REFUND' && previousBet !== undefined) {
    body.referenceExternalTransactionId = previousBet.externalTransactionId;
  }

  const response = postWager(body, idempotencyKey);
  recordOutcome(response, kind);

  if (kind === 'BET' && response.status === 201) {
    lastBetByVU[__VU] = { externalTransactionId, roundId };
  } else if (kind === 'REFUND' && response.status === 201) {
    delete lastBetByVU[__VU];
  }
}

export function hotWalletScenario() {
  const externalTransactionId = `hot-${__VU}-${__ITER}-${Date.now()}`;
  const body = {
    providerId: 'provider-load',
    externalTransactionId,
    playerId: hotWallet.playerId,
    walletId: hotWallet.walletId,
    roundId: `round-hot-${__VU}-${__ITER}`,
    gameId: 'load-test-game',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  };
  const response = postWager(body, `provider-load:${externalTransactionId}`);
  recordOutcome(response, 'BET');
}

const REPLAY_EXTERNAL_TRANSACTION_ID = 'replay-fixed-external-id';
const REPLAY_IDEMPOTENCY_KEY = `provider-load:${REPLAY_EXTERNAL_TRANSACTION_ID}`;

export function replayScenario() {
  const body = {
    providerId: 'provider-load',
    externalTransactionId: REPLAY_EXTERNAL_TRANSACTION_ID,
    playerId: replayWallet.playerId,
    walletId: replayWallet.walletId,
    roundId: 'round-replay',
    gameId: 'load-test-game',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  };
  const response = postWager(body, REPLAY_IDEMPOTENCY_KEY);

  check(response, {
    'replay: status é 200 ou 201': (r) => r.status === 200 || r.status === 201,
  });

  if (response.status === 200) {
    const parsed = JSON.parse(response.body);
    if (parsed.idempotentReplay === true) {
      replayCounter.add(1);
    }
  }
}

function recordOutcome(response, kind) {
  const ok = check(response, {
    'status é 201, 200, 202 ou 422': (r) =>
      r.status === 201 || r.status === 200 || r.status === 202 || r.status === 422,
  });

  if (!ok) {
    unexpectedErrorCounter.add(1);
    return;
  }

  if (response.status === 422) {
    const parsed = JSON.parse(response.body);
    if (parsed.failureCode === 'INSUFFICIENT_FUNDS') {
      insufficientFundsCounter.add(1);
    } else {
      unexpectedErrorCounter.add(1);
    }
    return;
  }

  processedCounter.add(1);
  if (response.status === 200) {
    const parsed = JSON.parse(response.body);
    if (parsed.idempotentReplay === true) {
      replayCounter.add(1);
    }
  }
}

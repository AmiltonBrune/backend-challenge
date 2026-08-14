import { describe, expect, it } from 'bun:test';
import { IdempotencyPayloadConflictError } from '@application/errors/idempotency-payload-conflict-error.ts';
import type {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionResult,
  ProcessWagerTransactionUseCase,
} from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';
import type {
  ProviderMetricInput,
  RejectionMetricInput,
  WagerTransactionMetricInput,
} from '@application/ports/metrics-port.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WageringController } from '@interface/http/controllers/wagering.controller.ts';

function fakeProcessUseCase(
  execute: (input: ProcessWagerTransactionInput) => Promise<ProcessWagerTransactionResult>,
): ProcessWagerTransactionUseCase {
  return { execute } as unknown as ProcessWagerTransactionUseCase;
}

function recordingMetrics(): {
  metrics: MetricsPort;
  transactions: WagerTransactionMetricInput[];
  replays: ProviderMetricInput[];
  conflicts: ProviderMetricInput[];
  rejections: RejectionMetricInput[];
} {
  const transactions: WagerTransactionMetricInput[] = [];
  const replays: ProviderMetricInput[] = [];
  const conflicts: ProviderMetricInput[] = [];
  const rejections: RejectionMetricInput[] = [];
  const metrics: MetricsPort = {
    recordWagerTransaction: (input) => transactions.push(input),
    recordIdempotentReplay: (input) => replays.push(input),
    recordIdempotencyConflict: (input) => conflicts.push(input),
    recordRejection: (input) => rejections.push(input),
    observeHttpRequestDuration: () => {},
    exposition: async () => ({ contentType: '', body: '' }),
  };
  return { metrics, transactions, replays, conflicts, rejections };
}

function fakeResponse(): { status(code: number): void } {
  return { status: () => {} };
}

const BASE_BODY = {
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  playerId: 'player-1',
  walletId: 'wallet-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.BET,
  money: { amount: '25.00', currency: 'BRL' },
};

describe('WageringController — instrumentação de métricas', () => {
  it('registra wager_transactions_total ao processar com sucesso', async () => {
    const { metrics, transactions, replays, rejections } = recordingMetrics();
    const useCase = fakeProcessUseCase(async () => ({
      transactionId: 'tx-1',
      status: WagerTransactionStatus.PROCESSED,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    }));
    const controller = new WageringController(
      useCase,
      {} as GetWagerTransactionUseCase,
      metrics,
    );

    await controller.create(BASE_BODY, 'idem-1', fakeResponse() as never);

    expect(transactions).toEqual([{ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' }]);
    expect(replays).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('registra wager_idempotent_replays_total quando a resposta é um replay', async () => {
    const { metrics, replays } = recordingMetrics();
    const useCase = fakeProcessUseCase(async () => ({
      transactionId: 'tx-1',
      status: WagerTransactionStatus.PROCESSED,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: true,
    }));
    const controller = new WageringController(useCase, {} as GetWagerTransactionUseCase, metrics);

    await controller.create(BASE_BODY, 'idem-1', fakeResponse() as never);

    expect(replays).toEqual([{ provider: 'provider-a' }]);
  });

  it('registra wager_rejections_total com o failureCode quando a transação é rejeitada', async () => {
    const { metrics, transactions, rejections } = recordingMetrics();
    const useCase = fakeProcessUseCase(async () => ({
      transactionId: 'tx-1',
      status: WagerTransactionStatus.REJECTED,
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
      idempotentReplay: false,
    }));
    const controller = new WageringController(useCase, {} as GetWagerTransactionUseCase, metrics);

    await controller.create(BASE_BODY, 'idem-1', fakeResponse() as never);

    expect(transactions).toEqual([{ kind: 'BET', status: 'REJECTED', provider: 'provider-a' }]);
    expect(rejections).toEqual([{ failureCode: FailureCode.INSUFFICIENT_FUNDS }]);
  });

  it('registra wager_idempotency_conflicts_total e propaga o erro quando há conflito de payload', async () => {
    const { metrics, conflicts } = recordingMetrics();
    const useCase = fakeProcessUseCase(async () => {
      throw new IdempotencyPayloadConflictError('provider-a', 'idem-1');
    });
    const controller = new WageringController(useCase, {} as GetWagerTransactionUseCase, metrics);

    await expect(controller.create(BASE_BODY, 'idem-1', fakeResponse() as never)).rejects.toBeInstanceOf(
      IdempotencyPayloadConflictError,
    );
    expect(conflicts).toEqual([{ provider: 'provider-a' }]);
  });
});

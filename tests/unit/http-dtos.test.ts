import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IdempotencyKeyHeaderDto,
  ListWalletLedgerQueryDto,
  MoneyDto,
  OpenWalletRequestDto,
  ProcessWagerTransactionRequestDto,
  ProviderExternalTransactionParamDto,
  TransactionIdParamDto,
  WagerMoneyDto,
  WalletIdParamDto,
} from '@interface/http/dto/index.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';

describe('MoneyDto', () => {
  it('aceita amount zero e currency suportada', async () => {
    const dto = plainToInstance(MoneyDto, { amount: '0.00', currency: 'BRL' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita amount positivo', async () => {
    const dto = plainToInstance(MoneyDto, { amount: '1000.00', currency: 'BRL' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita amount negativo', async () => {
    const dto = plainToInstance(MoneyDto, { amount: '-10.00', currency: 'BRL' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejeita amount com mais de duas casas decimais', async () => {
    const dto = plainToInstance(MoneyDto, { amount: '10.999', currency: 'BRL' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejeita currency não reconhecida', async () => {
    const dto = plainToInstance(MoneyDto, { amount: '10.00', currency: 'XYZ' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('WagerMoneyDto', () => {
  it('rejeita amount zero — diferente de MoneyDto, exige estritamente positivo', async () => {
    const dto = plainToInstance(WagerMoneyDto, { amount: '0.00', currency: 'BRL' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('aceita amount estritamente positivo', async () => {
    const dto = plainToInstance(WagerMoneyDto, { amount: '25.00', currency: 'BRL' });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('OpenWalletRequestDto', () => {
  it('aceita um payload válido', async () => {
    const dto = plainToInstance(OpenWalletRequestDto, {
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita playerId vazio', async () => {
    const dto = plainToInstance(OpenWalletRequestDto, {
      playerId: '',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('propaga a validação aninhada de initialBalance', async () => {
    const dto = plainToInstance(OpenWalletRequestDto, {
      playerId: 'player-1',
      initialBalance: { amount: '-10.00', currency: 'BRL' },
    });
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe('initialBalance');
  });
});

function baseWagerPayload(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.BET,
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}

describe('ProcessWagerTransactionRequestDto', () => {
  it('aceita BET sem referenceExternalTransactionId', async () => {
    const dto = plainToInstance(ProcessWagerTransactionRequestDto, baseWagerPayload());
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita REFUND com referenceExternalTransactionId', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({
        kind: WagerTransactionKind.REFUND,
        referenceExternalTransactionId: 'ext-bet-1',
      }),
    );
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita REFUND sem referenceExternalTransactionId', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({ kind: WagerTransactionKind.REFUND }),
    );
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'referenceExternalTransactionId')).toBe(true);
  });

  it('rejeita ROLLBACK sem referenceExternalTransactionId', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({ kind: WagerTransactionKind.ROLLBACK }),
    );
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'referenceExternalTransactionId')).toBe(true);
  });

  it('aceita kind OPENING sintaticamente — a rejeição é responsabilidade do caso de uso, não do DTO', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({ kind: WagerTransactionKind.OPENING }),
    );
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita um kind fora do enum', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({ kind: 'NAO_EXISTE' }),
    );
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejeita money com valor zero (money exige estritamente positivo)', async () => {
    const dto = plainToInstance(
      ProcessWagerTransactionRequestDto,
      baseWagerPayload({ money: { amount: '0.00', currency: 'BRL' } }),
    );
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('ListWalletLedgerQueryDto', () => {
  it('aceita sem cursor nem limit', async () => {
    const dto = plainToInstance(ListWalletLedgerQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita limit nos extremos do intervalo permitido', async () => {
    const min = plainToInstance(ListWalletLedgerQueryDto, { limit: '1' });
    const max = plainToInstance(ListWalletLedgerQueryDto, { limit: '100' });
    expect(await validate(min)).toHaveLength(0);
    expect(await validate(max)).toHaveLength(0);
  });

  it('rejeita limit fora do intervalo [1, 100]', async () => {
    const zero = plainToInstance(ListWalletLedgerQueryDto, { limit: '0' });
    const overMax = plainToInstance(ListWalletLedgerQueryDto, { limit: '101' });
    expect(await validate(zero)).not.toHaveLength(0);
    expect(await validate(overMax)).not.toHaveLength(0);
  });

  it('rejeita limit não inteiro', async () => {
    const dto = plainToInstance(ListWalletLedgerQueryDto, { limit: '1.5' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('IdempotencyKeyHeaderDto', () => {
  it('aceita uma chave válida', async () => {
    const dto = plainToInstance(IdempotencyKeyHeaderDto, { idempotencyKey: 'provider-a:ext-1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita chave vazia', async () => {
    const dto = plainToInstance(IdempotencyKeyHeaderDto, { idempotencyKey: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejeita chave com mais de 255 caracteres', async () => {
    const dto = plainToInstance(IdempotencyKeyHeaderDto, { idempotencyKey: 'a'.repeat(256) });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('Param DTOs', () => {
  it('WalletIdParamDto rejeita walletId vazio', async () => {
    const dto = plainToInstance(WalletIdParamDto, { walletId: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('TransactionIdParamDto rejeita transactionId vazio', async () => {
    const dto = plainToInstance(TransactionIdParamDto, { transactionId: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('ProviderExternalTransactionParamDto exige ambos os campos', async () => {
    const dto = plainToInstance(ProviderExternalTransactionParamDto, { providerId: 'provider-a' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

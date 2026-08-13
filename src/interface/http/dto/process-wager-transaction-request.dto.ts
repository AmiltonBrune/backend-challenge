import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerMoneyDto } from './wager-money.dto.ts';

const KINDS_REQUIRING_REFERENCE = new Set<WagerTransactionKind>([
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
]);

export class ProcessWagerTransactionRequestDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind, { message: 'kind não reconhecido' })
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => WagerMoneyDto)
  money!: WagerMoneyDto;

  @ValidateIf((dto: ProcessWagerTransactionRequestDto) => KINDS_REQUIRING_REFERENCE.has(dto.kind))
  @IsString()
  @IsNotEmpty({ message: 'referenceExternalTransactionId é obrigatório para REFUND e ROLLBACK' })
  referenceExternalTransactionId?: string;
}

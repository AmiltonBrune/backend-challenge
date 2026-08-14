import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerMoneyDto } from './wager-money.dto.ts';

const KINDS_REQUIRING_REFERENCE = new Set<WagerTransactionKind>([
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
]);

export class ProcessWagerTransactionRequestDto {
  @ApiProperty({ example: 'provider-a' })
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @ApiProperty({ example: 'bet-001', description: 'Id da transação no sistema do provedor.' })
  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @ApiProperty({ example: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1' })
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @ApiProperty({ example: '01145c5f-dc27-4bb8-a750-db94ff3c0303' })
  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @ApiProperty({ example: 'round-987' })
  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @ApiProperty({ example: 'fortune-chimp' })
  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @ApiProperty({ enum: WagerTransactionKind, example: WagerTransactionKind.BET })
  @IsEnum(WagerTransactionKind, { message: 'kind não reconhecido' })
  kind!: WagerTransactionKind;

  @ApiProperty({ type: WagerMoneyDto })
  @ValidateNested()
  @Type(() => WagerMoneyDto)
  money!: WagerMoneyDto;

  @ApiPropertyOptional({
    example: 'bet-001',
    description: 'Obrigatório para REFUND e ROLLBACK — o externalTransactionId sendo referenciado.',
  })
  @ValidateIf((dto: ProcessWagerTransactionRequestDto) => KINDS_REQUIRING_REFERENCE.has(dto.kind))
  @IsString()
  @IsNotEmpty({ message: 'referenceExternalTransactionId é obrigatório para REFUND e ROLLBACK' })
  referenceExternalTransactionId?: string;
}

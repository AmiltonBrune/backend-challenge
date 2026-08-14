import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';
import { MONEY_AMOUNT_PATTERN } from '@domain/money/money.ts';
import { SUPPORTED_CURRENCIES } from './supported-currencies.ts';

export class MoneyDto {
  @ApiProperty({
    example: '1000.00',
    description: 'Decimal textual não negativo, até 17 dígitos inteiros e até 2 casas decimais.',
  })
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount deve ser um decimal textual não negativo, até 17 dígitos inteiros e até 2 casas decimais',
  })
  amount!: string;

  @ApiProperty({ example: 'BRL', enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES, { message: 'currency não reconhecida' })
  currency!: string;
}

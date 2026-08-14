import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { IsPositiveMoneyAmount } from './validators/is-positive-money-amount.validator.ts';
import { SUPPORTED_CURRENCIES } from './supported-currencies.ts';

export class WagerMoneyDto {
  @ApiProperty({
    example: '25.00',
    description: 'Decimal textual estritamente positivo, até 17 dígitos inteiros e até 2 casas decimais.',
  })
  @IsPositiveMoneyAmount()
  amount!: string;

  @ApiProperty({ example: 'BRL', enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES, { message: 'currency não reconhecida' })
  currency!: string;
}

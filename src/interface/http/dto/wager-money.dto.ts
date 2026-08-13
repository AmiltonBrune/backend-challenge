import { IsIn } from 'class-validator';
import { IsPositiveMoneyAmount } from './validators/is-positive-money-amount.validator.ts';
import { SUPPORTED_CURRENCIES } from './supported-currencies.ts';

export class WagerMoneyDto {
  @IsPositiveMoneyAmount()
  amount!: string;

  @IsIn(SUPPORTED_CURRENCIES, { message: 'currency não reconhecida' })
  currency!: string;
}

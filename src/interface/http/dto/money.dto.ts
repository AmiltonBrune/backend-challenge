import { IsIn, Matches } from 'class-validator';
import { MONEY_AMOUNT_PATTERN } from '@domain/money/money.ts';
import { SUPPORTED_CURRENCIES } from './supported-currencies.ts';

export class MoneyDto {
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount deve ser um decimal textual não negativo, até 17 dígitos inteiros e até 2 casas decimais',
  })
  amount!: string;

  @IsIn(SUPPORTED_CURRENCIES, { message: 'currency não reconhecida' })
  currency!: string;
}

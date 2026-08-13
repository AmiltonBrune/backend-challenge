import type { ValidationOptions, ValidatorConstraintInterface } from 'class-validator';
import { ValidatorConstraint, Validate } from 'class-validator';
import { MONEY_AMOUNT_PATTERN } from '@domain/money/money.ts';

@ValidatorConstraint({ name: 'isPositiveMoneyAmount', async: false })
class IsPositiveMoneyAmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && MONEY_AMOUNT_PATTERN.test(value) && /[1-9]/.test(value);
  }

  defaultMessage(): string {
    return 'amount deve ser um decimal textual estritamente positivo, até 17 dígitos inteiros e até 2 casas decimais';
  }
}

export function IsPositiveMoneyAmount(validationOptions?: ValidationOptions): PropertyDecorator {
  return Validate(IsPositiveMoneyAmountConstraint, validationOptions);
}

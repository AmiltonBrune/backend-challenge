import type { ValueTransformer } from 'typeorm';

export const moneyAmountTransformer: ValueTransformer = {
  to: (value: string): string => value,
  from: (value: string): string => value,
};

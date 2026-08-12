import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class WalletNotFoundError extends BusinessRuleViolationError {
  constructor(walletId: string) {
    super(`Wallet não encontrada: ${walletId}.`, FailureCode.WALLET_NOT_FOUND);
  }
}

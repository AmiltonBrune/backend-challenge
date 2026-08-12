import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class PlayerWalletMismatchError extends BusinessRuleViolationError {
  constructor(playerId: string, walletId: string) {
    super(
      `Jogador ${playerId} não é titular da wallet ${walletId}.`,
      FailureCode.PLAYER_WALLET_MISMATCH,
    );
  }
}

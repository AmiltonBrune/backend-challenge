import type { FailureCode } from '../errors/failure-code.ts';
import { InvalidTransactionStateError } from '../errors/invalid-transaction-state-error.ts';
import { InvalidWagerTransactionError } from '../errors/invalid-wager-transaction-error.ts';
import { LedgerDirection } from '../ledger/ledger-direction.ts';
import type { Money } from '../money/money.ts';
import { WagerTransactionKind } from './wager-transaction-kind.ts';
import type {
  CreateWagerTransactionProps,
  RehydrateWagerTransactionProps,
} from './wager-transaction-props.ts';
import { WagerTransactionStatus } from './wager-transaction-status.ts';

function requiresReferenceFor(kind: WagerTransactionKind): boolean {
  return kind === WagerTransactionKind.REFUND || kind === WagerTransactionKind.ROLLBACK;
}

function invert(direction: LedgerDirection): LedgerDirection {
  return direction === LedgerDirection.CREDIT ? LedgerDirection.DEBIT : LedgerDirection.CREDIT;
}

export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly kind: WagerTransactionKind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId: string | undefined;
  private readonly _createdAt: Date;
  private _referenceTransactionId: string | undefined;
  private _status: WagerTransactionStatus;
  private _failureCode: FailureCode | undefined;
  private _processedAt: Date | undefined;

  private constructor(props: RehydrateWagerTransactionProps) {
    this.id = props.id;
    this.providerId = props.providerId;
    this.externalTransactionId = props.externalTransactionId;
    this.idempotencyKey = props.idempotencyKey;
    this.payloadHash = props.payloadHash;
    this.walletId = props.walletId;
    this.playerId = props.playerId;
    this.roundId = props.roundId;
    this.kind = props.kind;
    this.money = props.money;
    this.referenceExternalTransactionId = props.referenceExternalTransactionId;
    this._createdAt = new Date(props.createdAt.getTime());
    this._referenceTransactionId = props.referenceTransactionId;
    this._status = props.status;
    this._failureCode = props.failureCode;
    this._processedAt = props.processedAt === undefined ? undefined : new Date(props.processedAt.getTime());
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError('money deve ser estritamente positivo');
    }
    if (requiresReferenceFor(props.kind) && props.referenceExternalTransactionId === undefined) {
      throw new InvalidWagerTransactionError(
        `${props.kind} exige referenceExternalTransactionId`,
      );
    }

    return new WagerTransaction({ ...props, status: WagerTransactionStatus.PENDING });
  }

  static rehydrate(props: RehydrateWagerTransactionProps): WagerTransaction {
    return new WagerTransaction(props);
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  status(): WagerTransactionStatus {
    return this._status;
  }

  failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  processedAt(): Date | undefined {
    return this._processedAt === undefined ? undefined : new Date(this._processedAt.getTime());
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.PROCESSED ||
      this._status === WagerTransactionStatus.REJECTED ||
      this._status === WagerTransactionStatus.FAILED
    );
  }

  requiresReference(): boolean {
    return requiresReferenceFor(this.kind);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.LOSS;
  }

  matchesPayload(hash: string): boolean {
    return this.payloadHash === hash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.OPENING:
      case WagerTransactionKind.WIN:
      case WagerTransactionKind.REFUND:
        return LedgerDirection.CREDIT;
      case WagerTransactionKind.BET:
        return LedgerDirection.DEBIT;
      case WagerTransactionKind.ROLLBACK:
        if (reference === undefined) {
          throw new InvalidWagerTransactionError('ROLLBACK exige a transação de referência resolvida');
        }
        return invert(reference.ledgerDirectionFor());
      case WagerTransactionKind.LOSS:
        throw new InvalidWagerTransactionError('LOSS não possui direção de ledger — affectsBalance() é falso');
    }
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal('markProcessed');
    this._status = WagerTransactionStatus.PROCESSED;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = new Date(at.getTime());
  }

  markPendingReference(): void {
    if (this._status !== WagerTransactionStatus.PENDING) {
      throw new InvalidTransactionStateError(this._status, 'markPendingReference');
    }
    this._status = WagerTransactionStatus.PENDING_REFERENCE;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal('reject');
    this._status = WagerTransactionStatus.REJECTED;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal('fail');
    this._status = WagerTransactionStatus.FAILED;
    this._failureCode = code;
  }

  private assertNotTerminal(attemptedTransition: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, attemptedTransition);
    }
  }
}

export interface PayloadHashInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: string;
  readonly money: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly referenceExternalTransactionId?: string;
}

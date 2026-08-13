import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';

export interface LedgerPage {
  readonly entries: readonly WalletLedgerEntry[];
  readonly nextCursor: string | undefined;
  readonly hasMore: boolean;
}

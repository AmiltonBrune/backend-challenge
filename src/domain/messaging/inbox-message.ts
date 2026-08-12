interface ReceiveInboxMessageProps {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
}

interface InboxMessageState extends ReceiveInboxMessageProps {
  readonly processedAt?: Date;
}

export class InboxMessage {
  public readonly messageId: string;
  public readonly consumerName: string;
  public readonly payloadHash: string;
  private _processedAt: Date | undefined;

  private constructor(props: InboxMessageState) {
    this.messageId = props.messageId;
    this.consumerName = props.consumerName;
    this.payloadHash = props.payloadHash;
    this._processedAt = props.processedAt === undefined ? undefined : new Date(props.processedAt.getTime());
  }

  static receive(props: ReceiveInboxMessageProps): InboxMessage {
    return new InboxMessage(props);
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(state);
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  processedAt(): Date | undefined {
    return this._processedAt === undefined ? undefined : new Date(this._processedAt.getTime());
  }

  markProcessed(at: Date): void {
    this._processedAt = new Date(at.getTime());
  }
}

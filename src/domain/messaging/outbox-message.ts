import { InvalidOutboxMessageError } from '../errors/invalid-outbox-message-error.ts';
import type { IntegrationEvent } from '../events/integration-event.ts';
import type { IntegrationEventEnvelope } from '../events/integration-event-props.ts';

const BACKOFF_CAP_SECONDS = 300;
const JITTER_RATIO = 0.2;

interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: IntegrationEventEnvelope<unknown>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt: Date | undefined;
  readonly publishedAt: Date | undefined;
}

export class OutboxMessage {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  private readonly _payload: IntegrationEventEnvelope<unknown>;
  private readonly _occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt: Date | undefined;
  private _publishedAt: Date | undefined;

  private constructor(state: OutboxMessageState) {
    this.id = state.id;
    this.aggregateId = state.aggregateId;
    this.eventType = state.eventType;
    this._payload = structuredClone(state.payload);
    this._occurredAt = new Date(state.occurredAt.getTime());
    this._attempts = state.attempts;
    this._nextAttemptAt =
      state.nextAttemptAt === undefined ? undefined : new Date(state.nextAttemptAt.getTime());
    this._publishedAt =
      state.publishedAt === undefined ? undefined : new Date(state.publishedAt.getTime());
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: undefined,
      publishedAt: undefined,
    });
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }

  get payload(): IntegrationEventEnvelope<unknown> {
    return structuredClone(this._payload);
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  attempts(): number {
    return this._attempts;
  }

  nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt === undefined ? undefined : new Date(this._nextAttemptAt.getTime());
  }

  publishedAt(): Date | undefined {
    return this._publishedAt === undefined ? undefined : new Date(this._publishedAt.getTime());
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    return this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    this.assertPending('markPublished');
    this._publishedAt = new Date(at.getTime());
  }

  scheduleRetry(now: Date): void {
    this.assertPending('scheduleRetry');
    this._attempts += 1;

    const baseSeconds = Math.min(2 ** this._attempts, BACKOFF_CAP_SECONDS);
    const jitterSeconds = Math.random() * baseSeconds * JITTER_RATIO;
    const delayMs = (baseSeconds + jitterSeconds) * 1000;

    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  private assertPending(operation: string): void {
    if (!this.isPending()) {
      throw new InvalidOutboxMessageError(`${operation} chamado em mensagem já publicada`);
    }
  }
}

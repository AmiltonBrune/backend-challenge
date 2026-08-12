export interface IntegrationEventProps<T> {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly data: T;
}

export interface IntegrationEventEnvelope<T> {
  readonly eventId: string;
  readonly eventType: string;
  readonly version: number;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly data: T;
}

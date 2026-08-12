import type { IntegrationEventEnvelope, IntegrationEventProps } from './integration-event-props.ts';

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly correlationId: string;
  private readonly _occurredAt: Date;
  private readonly _data: T;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this._occurredAt = new Date(props.occurredAt.getTime());
    this._data = structuredClone(props.data);
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  get data(): T {
    return structuredClone(this._data);
  }

  toJSON(): IntegrationEventEnvelope<T> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      occurredAt: this._occurredAt.toISOString(),
      data: structuredClone(this._data),
    };
  }
}

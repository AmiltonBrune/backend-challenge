import type { IdGenerator } from '@application/ports/id-generator.ts';

export class UuidIdGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}

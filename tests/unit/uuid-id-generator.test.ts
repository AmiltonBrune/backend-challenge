import { describe, expect, it } from 'bun:test';
import { UuidIdGenerator } from '@infrastructure/uuid-id-generator.ts';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('UuidIdGenerator', () => {
  it('gera um UUID v4 válido', () => {
    const id = new UuidIdGenerator().generate();
    expect(id).toMatch(UUID_V4_PATTERN);
  });

  it('gera valores diferentes a cada chamada', () => {
    const generator = new UuidIdGenerator();
    const first = generator.generate();
    const second = generator.generate();

    expect(first).not.toBe(second);
  });
});

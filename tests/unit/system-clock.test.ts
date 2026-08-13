import { describe, expect, it } from 'bun:test';
import { SystemClock } from '@infrastructure/system-clock.ts';

describe('SystemClock', () => {
  it('retorna a hora atual do sistema', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it('retorna instâncias novas a cada chamada', () => {
    const clock = new SystemClock();
    const first = clock.now();
    const second = clock.now();

    expect(first).not.toBe(second);
  });
});

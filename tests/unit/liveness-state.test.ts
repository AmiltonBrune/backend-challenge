import { describe, expect, it } from 'bun:test';
import { LivenessState } from '@application/health/liveness-state.ts';

describe('LivenessState', () => {
  it('começa saudável', () => {
    const state = new LivenessState();

    expect(state.isHealthy()).toBe(true);
  });

  it('fica não-saudável após markUnhealthy e permanece assim', () => {
    const state = new LivenessState();

    state.markUnhealthy();

    expect(state.isHealthy()).toBe(false);

    state.markUnhealthy();

    expect(state.isHealthy()).toBe(false);
  });
});

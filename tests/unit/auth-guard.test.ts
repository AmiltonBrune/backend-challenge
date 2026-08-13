import { describe, expect, it } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@interface/http/guards/auth.guard.ts';

function fakeExecutionContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    switchToRpc: () => {
      throw new Error('não usado');
    },
    switchToWs: () => {
      throw new Error('não usado');
    },
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getType: () => 'http',
    getClass: () => AuthGuard,
    getHandler: () => fakeExecutionContext,
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('sempre libera a requisição', () => {
    const guard = new AuthGuard();

    expect(guard.canActivate(fakeExecutionContext())).toBe(true);
  });
});

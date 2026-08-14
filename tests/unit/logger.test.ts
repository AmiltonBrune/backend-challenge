import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { logger } from '@infrastructure/observability/logger.ts';
import { runWithCorrelationId } from '@infrastructure/observability/correlation-context.ts';

type ConsoleMethod = 'log' | 'error';

function captureConsole(method: ConsoleMethod): { lines: string[]; restore: () => void } {
  const original = console[method];
  const lines: string[] = [];
  console[method] = ((...args: unknown[]) => {
    lines.push(String(args[0]));
  }) as typeof console.log;
  return {
    lines,
    restore: () => {
      console[method] = original;
    },
  };
}

describe('logger', () => {
  let logCapture: { lines: string[]; restore: () => void };
  let errorCapture: { lines: string[]; restore: () => void };

  beforeEach(() => {
    logCapture = captureConsole('log');
    errorCapture = captureConsole('error');
  });

  afterEach(() => {
    logCapture.restore();
    errorCapture.restore();
  });

  it('emite logger.info como uma linha JSON com timestamp, level e message', () => {
    logger.info('operação concluída');

    expect(logCapture.lines.length).toBe(1);
    const parsed = JSON.parse(logCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('operação concluída');
    expect(typeof parsed['timestamp']).toBe('string');
    expect(Number.isNaN(Date.parse(parsed['timestamp'] as string))).toBe(false);
  });

  it('não inclui correlationId quando não há contexto ativo', () => {
    logger.info('sem contexto');

    const parsed = JSON.parse(logCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['correlationId']).toBeUndefined();
  });

  it('inclui o correlationId ativo do AsyncLocalStorage', () => {
    runWithCorrelationId('corr-log-1', () => {
      logger.info('dentro do contexto');
    });

    const parsed = JSON.parse(logCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['correlationId']).toBe('corr-log-1');
  });

  it('mescla metadados adicionais na linha de log', () => {
    logger.info('transação processada', { transactionId: 'tx-1', status: 'PROCESSED' });

    const parsed = JSON.parse(logCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['transactionId']).toBe('tx-1');
    expect(parsed['status']).toBe('PROCESSED');
  });

  it('logger.warn usa level warn e console.log', () => {
    logger.warn('atenção');

    expect(logCapture.lines.length).toBe(1);
    const parsed = JSON.parse(logCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['level']).toBe('warn');
  });

  it('logger.error usa level error e console.error', () => {
    logger.error('falhou', { failureCode: 'INSUFFICIENT_FUNDS' });

    expect(errorCapture.lines.length).toBe(1);
    expect(logCapture.lines.length).toBe(0);
    const parsed = JSON.parse(errorCapture.lines[0] as string) as Record<string, unknown>;
    expect(parsed['level']).toBe('error');
    expect(parsed['failureCode']).toBe('INSUFFICIENT_FUNDS');
  });
});

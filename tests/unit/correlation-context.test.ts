import { describe, expect, it } from 'bun:test';
import { getCorrelationId, runWithCorrelationId } from '@infrastructure/observability/correlation-context.ts';

describe('correlation-context', () => {
  it('retorna undefined fora de qualquer contexto ativo', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('retorna o correlationId ativo dentro de runWithCorrelationId', () => {
    runWithCorrelationId('corr-1', () => {
      expect(getCorrelationId()).toBe('corr-1');
    });
  });

  it('restaura o estado anterior ao sair do contexto', () => {
    runWithCorrelationId('corr-1', () => {
      expect(getCorrelationId()).toBe('corr-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propaga o correlationId através de fronteiras assíncronas', async () => {
    await runWithCorrelationId('corr-async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getCorrelationId()).toBe('corr-async');
    });
  });

  it('isola correlationIds de execuções aninhadas independentes', () => {
    runWithCorrelationId('outer', () => {
      runWithCorrelationId('inner', () => {
        expect(getCorrelationId()).toBe('inner');
      });
      expect(getCorrelationId()).toBe('outer');
    });
  });

  it('retorna o valor produzido pela função executada', () => {
    const result = runWithCorrelationId('corr-1', () => 42);
    expect(result).toBe(42);
  });
});

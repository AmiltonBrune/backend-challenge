import { describe, expect, it } from 'bun:test';
import { isInfrastructureUnavailable } from '@interface/http/infrastructure-unavailable.ts';

describe('isInfrastructureUnavailable', () => {
  it('reconhece erro de conexão recusada exposto diretamente em .code', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(isInfrastructureUnavailable(error)).toBe(true);
  });

  it('reconhece erro de conexão embrulhado em .driverError, como o QueryFailedError do TypeORM', () => {
    const driverError = Object.assign(new Error('server closed the connection'), {
      code: '57P03',
    });
    const wrapped = Object.assign(new Error('query failed'), { driverError });
    expect(isInfrastructureUnavailable(wrapped)).toBe(true);
  });

  it('reconhece timeout de conexão', () => {
    const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(isInfrastructureUnavailable(error)).toBe(true);
  });

  it('não reconhece erro de violação de constraint como indisponibilidade', () => {
    const error = Object.assign(new Error('duplicate key value'), { code: '23505' });
    expect(isInfrastructureUnavailable(error)).toBe(false);
  });

  it('não reconhece erro de domínio sem código de driver', () => {
    expect(isInfrastructureUnavailable(new Error('saldo insuficiente'))).toBe(false);
  });

  it('não reconhece valores que não são Error', () => {
    expect(isInfrastructureUnavailable('string qualquer')).toBe(false);
    expect(isInfrastructureUnavailable(undefined)).toBe(false);
    expect(isInfrastructureUnavailable(null)).toBe(false);
  });
});

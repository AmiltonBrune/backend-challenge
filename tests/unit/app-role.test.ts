import { describe, expect, it } from 'bun:test';
import { resolveAppRole } from '@infrastructure/bootstrap/app-role.ts';

describe('resolveAppRole', () => {
  it('aceita api', () => {
    expect(resolveAppRole('api')).toBe('api');
  });

  it('aceita consumer', () => {
    expect(resolveAppRole('consumer')).toBe('consumer');
  });

  it('aceita worker', () => {
    expect(resolveAppRole('worker')).toBe('worker');
  });

  it('rejeita papel desconhecido', () => {
    expect(() => resolveAppRole('scheduler')).toThrow(/APP_ROLE/);
  });

  it('rejeita ausência de papel', () => {
    expect(() => resolveAppRole(undefined)).toThrow(/APP_ROLE/);
  });

  it('rejeita string vazia', () => {
    expect(() => resolveAppRole('')).toThrow(/APP_ROLE/);
  });
});

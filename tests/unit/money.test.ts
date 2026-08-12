import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { CurrencyMismatchError } from '@domain/errors/currency-mismatch-error.ts';

describe('Money.from — entradas válidas', () => {
  const validAmounts: readonly [string, string][] = [
    ['5', '5.00'],
    ['5.5', '5.50'],
    ['5.50', '5.50'],
    ['0', '0.00'],
    ['0.00', '0.00'],
    ['1000000.00', '1000000.00'],
    ['0.01', '0.01'],
  ];

  for (const [input, normalized] of validAmounts) {
    it(`normaliza "${input}" para escala 2 como "${normalized}"`, () => {
      const money = Money.from({ amount: input, currency: 'BRL' });

      expect(money.toJSON().amount).toBe(normalized);
      expect(money.toJSON().currency).toBe('BRL');
      expect(typeof money.toJSON().amount).toBe('string');
    });
  }
});

describe('Money.from — entradas rejeitadas', () => {
  const invalidAmounts = [
    '',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e3',
    '1.5e-2',
    '5.123',
    '-5.00',
    '-0.01',
    'abc',
    '5.',
    '.5',
  ];

  for (const amount of invalidAmounts) {
    it(`rejeita amount "${amount}"`, () => {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    });
  }

  it('rejeita moeda vazia', () => {
    expect(() => Money.from({ amount: '5.00', currency: '' })).toThrow();
  });

  it('aceita ate 17 digitos inteiros — limite de NUMERIC(19,2)', () => {
    const money = Money.from({ amount: '99999999999999999.99', currency: 'BRL' });

    expect(money.toJSON().amount).toBe('99999999999999999.99');
  });

  it('rejeita 18 ou mais digitos inteiros — excederia NUMERIC(19,2) e a precisao do decimal.js', () => {
    expect(() =>
      Money.from({ amount: '100000000000000000.00', currency: 'BRL' }),
    ).toThrow();
  });

  it('nunca perde centavos em soma com valor no limite de precisao', () => {
    const grande = Money.from({ amount: '99999999999999999.99', currency: 'BRL' });
    const centavo = Money.from({ amount: '0.01', currency: 'BRL' });

    expect(() => grande.add(centavo)).not.toThrow();
  });
});

describe('Money — imutabilidade', () => {
  it('add nao altera a instancia original', () => {
    const original = Money.from({ amount: '10.00', currency: 'BRL' });
    const other = Money.from({ amount: '5.00', currency: 'BRL' });

    original.add(other);

    expect(original.toJSON().amount).toBe('10.00');
  });

  it('subtract nao altera a instancia original', () => {
    const original = Money.from({ amount: '10.00', currency: 'BRL' });
    const other = Money.from({ amount: '5.00', currency: 'BRL' });

    original.subtract(other);

    expect(original.toJSON().amount).toBe('10.00');
  });

  it('negate nao altera a instancia original', () => {
    const original = Money.from({ amount: '10.00', currency: 'BRL' });

    original.negate();

    expect(original.toJSON().amount).toBe('10.00');
    expect(original.isPositive()).toBe(true);
  });
});

describe('Money.add', () => {
  it('soma corretamente e retorna nova instancia', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.25', currency: 'BRL' });

    const result = a.add(b);

    expect(result.toJSON().amount).toBe('15.25');
    expect(result).not.toBe(a);
  });

  it('lanca CurrencyMismatchError com moedas diferentes', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'USD' });

    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  it('mantem exatidao apos somas sucessivas — sem erro de ponto flutuante', () => {
    const dez = Money.from({ amount: '0.10', currency: 'BRL' });
    const soma = dez.add(dez).add(dez);

    expect(soma.toJSON().amount).toBe('0.30');
  });
});

describe('Money.subtract', () => {
  it('subtrai corretamente', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '3.33', currency: 'BRL' });

    expect(a.subtract(b).toJSON().amount).toBe('6.67');
  });

  it('lanca CurrencyMismatchError com moedas diferentes', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'USD' });

    expect(() => a.subtract(b)).toThrow(CurrencyMismatchError);
  });

  it('mantem exatidao apos subtracoes sucessivas', () => {
    const um = Money.from({ amount: '1.00', currency: 'BRL' });
    const resultado = um.subtract(
      Money.from({ amount: '0.10', currency: 'BRL' }),
    ).subtract(Money.from({ amount: '0.10', currency: 'BRL' })).subtract(
      Money.from({ amount: '0.10', currency: 'BRL' }),
    );

    expect(resultado.toJSON().amount).toBe('0.70');
  });
});

describe('Money.negate', () => {
  it('inverte o sinal de um valor positivo', () => {
    const positivo = Money.from({ amount: '10.00', currency: 'BRL' });
    const negativo = positivo.negate();

    expect(negativo.isNegative()).toBe(true);
    expect(negativo.toJSON().amount).toBe('-10.00');
  });

  it('negar zero continua zero', () => {
    const zero = Money.zero('BRL');

    expect(zero.negate().isZero()).toBe(true);
  });
});

describe('Money — classificação de sinal', () => {
  it('isZero, isPositive e isNegative são mutuamente exclusivos', () => {
    const zero = Money.zero('BRL');
    const positivo = Money.from({ amount: '1.00', currency: 'BRL' });
    const negativo = positivo.negate();

    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);

    expect(positivo.isPositive()).toBe(true);
    expect(positivo.isZero()).toBe(false);
    expect(positivo.isNegative()).toBe(false);

    expect(negativo.isNegative()).toBe(true);
    expect(negativo.isZero()).toBe(false);
    expect(negativo.isPositive()).toBe(false);
  });
});

describe('Money.isLessThan', () => {
  it('compara corretamente', () => {
    const menor = Money.from({ amount: '5.00', currency: 'BRL' });
    const maior = Money.from({ amount: '10.00', currency: 'BRL' });

    expect(menor.isLessThan(maior)).toBe(true);
    expect(maior.isLessThan(menor)).toBe(false);
  });

  it('lanca CurrencyMismatchError com moedas diferentes', () => {
    const a = Money.from({ amount: '5.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'USD' });

    expect(() => a.isLessThan(b)).toThrow(CurrencyMismatchError);
  });
});

describe('Money.equals', () => {
  it('true para mesmo valor e moeda', () => {
    const a = Money.from({ amount: '5.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'BRL' });

    expect(a.equals(b)).toBe(true);
  });

  it('false para valores diferentes', () => {
    const a = Money.from({ amount: '5.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.01', currency: 'BRL' });

    expect(a.equals(b)).toBe(false);
  });

  it('lanca CurrencyMismatchError com moedas diferentes, nunca retorna false silenciosamente', () => {
    const a = Money.from({ amount: '5.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'USD' });

    expect(() => a.equals(b)).toThrow(CurrencyMismatchError);
  });
});

describe('Money.zero', () => {
  it('cria valor zero na moeda informada', () => {
    const zero = Money.zero('BRL');

    expect(zero.toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(zero.isZero()).toBe(true);
  });
});

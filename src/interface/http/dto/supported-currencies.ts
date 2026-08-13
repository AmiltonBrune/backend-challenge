export const SUPPORTED_CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

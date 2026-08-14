import { getCorrelationId } from './correlation-context.ts';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogMeta = Readonly<Record<string, unknown>>;

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  const correlationId = getCorrelationId();
  const line: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...meta,
  };

  const serialized = JSON.stringify(line);
  if (level === 'error') {
    console.error(serialized);
    return;
  }
  console.log(serialized);
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write('info', message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write('warn', message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write('error', message, meta);
  },
};

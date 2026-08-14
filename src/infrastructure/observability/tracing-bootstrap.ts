import { startTracing } from './tracing.ts';

const role = process.env['APP_ROLE'] ?? 'unknown';
startTracing(`wagering-${role}`);

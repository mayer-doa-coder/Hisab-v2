// index.ts — the process entrypoint. Everything it does is read configuration,
// run migrations, and listen; all behaviour lives in the modules it wires.

import { createPool } from './db/pool';
import { migrate } from './db/migrate';
import { createServer } from './server';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = required('DATABASE_URL');

  // SECURITY.md §3: reject plaintext HTTP in every build configuration that
  // could ship. TLS terminates ahead of this process, so what is enforced
  // here is that the deployment declares it — an unset value in production is
  // a misconfiguration, not a default to silently accept.
  if (process.env.NODE_ENV === 'production' && process.env.TLS_TERMINATED !== 'true') {
    throw new Error('Refusing to start in production without TLS_TERMINATED=true (SECURITY.md §3).');
  }

  const pool = createPool({ connectionString });
  const result = await migrate(pool);
  console.warn(`[server] migrations applied: ${result.applied.length}, already present: ${result.skipped.length}`);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const port = Number(process.env.PORT ?? 8080);
  createServer({ pool, allowedOrigins }).listen(port, () => {
    console.warn(`[server] listening on ${port}`);
  });
}

main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exitCode = 1;
});

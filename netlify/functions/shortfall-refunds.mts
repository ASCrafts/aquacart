import type { Config } from '@netlify/functions';

/**
 * Thin scheduled trigger for GET /api/cron/shortfall-refunds.
 *
 * All the logic lives in the Next.js route — this function exists only
 * because Netlify can only attach a `schedule` to a real Netlify Function,
 * not to an App Router route handler. See the comment block above
 * `[functions."shortfall-refunds"]` in netlify.toml for why.
 *
 * `process.env.URL` is Netlify's own primary site URL env var, always set at
 * runtime; it is deliberately not `NEXT_PUBLIC_APP_URL`, which can be a
 * developer's localhost value baked in at build time.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Mirror the route's own fail-closed behaviour rather than calling it
    // with no Authorization header and getting a 401 every 15 minutes.
    console.error('[cron:shortfall-refunds] CRON_SECRET is not set — skipping.');
    return new Response('CRON_SECRET not set', { status: 500 });
  }

  const res = await fetch(`${process.env.URL}/api/cron/shortfall-refunds`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    console.error(`[cron:shortfall-refunds] route responded ${res.status}`);
  }
  return res;
};

export const config: Config = { schedule: '*/15 * * * *' };

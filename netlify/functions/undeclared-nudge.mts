import type { Config } from '@netlify/functions';

/**
 * Thin scheduled trigger for GET /api/cron/undeclared-nudge.
 * See netlify/functions/shortfall-refunds.mts for why this wrapper exists.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron:undeclared-nudge] CRON_SECRET is not set — skipping.');
    return new Response('CRON_SECRET not set', { status: 500 });
  }

  const res = await fetch(`${process.env.URL}/api/cron/undeclared-nudge`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    console.error(`[cron:undeclared-nudge] route responded ${res.status}`);
  }
  return res;
};

export const config: Config = { schedule: '*/15 * * * *' };

# AquaCart

Fresh-fish delivery. One catch, one day, sold by the kilogram.

Next 16 (app router) · Prisma 6 + MySQL/TiDB · NextAuth 5 · Firebase (phone OTP + FCM) ·
Razorpay · Tailwind + shadcn/ui.

## The two ideas

1. **Stock is kilograms, and it belongs to a day, not to a fish.** One `DayStock` row per
   (fish, business day) holds `planned`, `declared`, `reserved`, `sold` and that day's price.
2. **A catch is sellable for exactly one business day**, 04:00 → 04:00 IST. Yesterday's rows
   stop being sellable at 04:00 with no admin action.

Order cutoff is **19:30 IST** — before it, today's catch delivered today; after it, tomorrow's.
Everything in [`src/lib/business-day.ts`](src/lib/business-day.ts) compares **elapsed minutes
since 04:00**, never the wall clock, because between midnight and 04:00 the two disagree and
the wall clock is wrong.

Read [`docs/architecture-rev3.md`](docs/architecture-rev3.md) before changing anything in
`src/lib/stock.ts`, `src/lib/allocation.ts` or `src/lib/business-day.ts`.

## Running it

```bash
npm install
cp .env.example .env        # then fill it in — see the comments in that file
npx prisma generate
npx prisma db push          # greenfield; see docs/rev3-migration.sql for the SQL
npm run db:import-fish      # catalog + nutrition defaults
npm run db:seed             # admin user + today's and tomorrow's DayStock rows

npm run dev                 # app on :9002
npm run ws:dev              # admin alert WebSocket on :3001 (needs WSS_BROADCAST_SECRET)
```

```bash
npm test          # vitest — the business-day and allocation suites are the ones that matter
npm run typecheck
```

## Scheduled jobs

All under `/api/cron/*`, all requiring `Authorization: Bearer $CRON_SECRET`, all fail closed
when the secret is unset. They are idempotent and catch up after a missed run, so the cadence
below is a floor, not a contract.

| Route | Cadence | What it does |
|---|---|---|
| `shortfall-refunds` | every 15 min | Auto-refunds short-fall lines unanswered past 08:00 IST |
| `undeclared-nudge` | hourly | Pushes the admin if today is still undeclared after 05:00 IST |
| `drain-notifications` | every 5 min | Sends queued FCM pushes, honouring quiet hours and the daily marketing cap |

The 08:00 refund happens whether or not anyone opens the dashboard. That is deliberate: an
unresolved short-fall is the worst outcome, so resolution cannot depend on the admin being
awake.

## The admin's job

Open `/admin/stock` and **declare the catch**. That is the whole daily loop. Allocation runs,
short-fall pushes go out, refunds land at 08:00. The short-fall panel exists so a substitute
*can* be offered, not because the system needs one.

## Layout

```
src/lib/business-day.ts    the 04:00→04:00 IST clock, the 19:30 cutoff, delivery slots
src/lib/allocation.ts      pure FIFO + half-order part-fill allocator (no clock, no DB)
src/lib/stock.ts           DayStock reads, atomic reserve/release, declareStock, the admin sheet
src/lib/refunds.ts         idempotent Razorpay refunds
src/lib/notifications.ts   admin WebSocket + queued customer FCM
src/lib/identity.ts        username | phone | email — one login field
src/lib/nutrition.ts       Zod-validated per-100 g panel data
```

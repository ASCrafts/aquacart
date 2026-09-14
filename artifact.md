# Aquacart — design brief, rev 3 (Sep 2026)

Full illustrated version: https://claude.ai/code/artifact/3bf25ef2-3610-4111-b40c-b580545960ce

Written against `ASCrafts/aquacart@9812bcf` — Next 16, Prisma 6, MySQL, NextAuth 5 beta, Firebase.

## Decisions locked

| Area | Decision |
|---|---|
| Unit | Kilograms everywhere. One stock pool. Pieces are a display helper only |
| Business day | 04:00 → 04:00 IST |
| Cutoff | **19:30 IST**. Before it → today's catch, delivered today. After → tomorrow's catch |
| Day 2 | **None.** A catch is sellable for exactly one business day. No carry-over, no discounts |
| Short catch | FIFO by `paidAt`, half-order part-fill rule, auto-refund at 08:00 |
| Admin | One "Today's Stock" sheet, today column + tomorrow column |
| Tomorrow column | Maintained by admin, pre-filled from a rolling median |
| Nutrition | `Json?` column on Product, admin-editable, seeded from defaults |
| Login | Single field accepting email / username / phone + password |
| Verification | Firebase phone OTP at signup (built locally, not yet on `main`) |
| Admin accounts | One admin login |
| Notifications | WebSocket alerts for admin; FCM order tracking + moment marketing for customers |
| Delivery slots | Two auto-assigned runs now; customer-chosen windows with capacity later |
| Data | Greenfield — schema free to reshape |

## 00 — Existing issues in the code

**Bugs (fix first):**

1. `POST /broadcast` on the WebSocket server has **no authentication** — the upgrade handshake checks a JWT, the HTTP hook beside it checks nothing. `src/server/websocket.ts:11–28`
2. Checkout ignores `CartItem.unit` — a kg order validates, prices and reserves against the *piece* pool. `api/checkout/create/route.ts:49–91`
3. The checkout transaction is fake — `mongoose-mock.ts` `MockSession` no-ops `startTransaction`/`commit`.
4. Two stock pools (`quantity`, `stockKg`) move independently for one physical fish.

**Drift:** 5. `restockedAt` only set in the admin `PUT`, so AI-added stock never reaches "Freshly Stocked". 6. AI sync uses `{ increment }` — pressing Sync twice doubles stock.

**Debt:** 7. Mongoose-shaped shim over Prisma hides conditional updates and real transactions. 8. Email required, verified by link, whitelisted to 4 domains.

Recent auth hardening (secure cookie prefixes, `exp` on the WS access token, no token logging) is good and stays.

## R1 — Catch cycle and order book

**Kilos only.** `quantity`, `stockKg`, `price`, `pricePerKg` and `CartItem.unit` collapse into kg of stock at a price per kg. 250 g steps, `minOrderKg` / `maxOrderKg`. Optional `avgPieceWeight` renders "≈ 1 fish, about 600 g" as a helper — the transaction stays in kilos.

**The day:** 04:00 → 04:00 IST. Yesterday's rows become unsellable at 04:00 with no admin action. The only manual step in the cycle is declaring what landed.

**Bug fixed from rev 2 — the cutoff must use elapsed minutes, not the wall clock.** Comparing the clock hour to 19:30 is wrong for every minute between midnight and 04:00: the business day has already rolled back to yesterday but the clock reads `01:00 < 19:30`, so a 1 a.m. order would be sold yesterday's catch, which no longer exists. Verified across the clock:

| IST clock | Business day | Minutes in | Wall-clock rule | Elapsed rule |
|---|---|---|---|---|
| 19:29 | Sep 13 | 929 | Sep 13 | Sep 13 ✓ |
| 19:31 | Sep 13 | 931 | Sep 14 | Sep 14 ✓ |
| 23:59 | Sep 13 | 1199 | Sep 14 | Sep 14 ✓ |
| 00:00 | Sep 13 | 1200 | Sep 13 ✗ | Sep 14 ✓ |
| 03:59 | Sep 13 | 1439 | Sep 13 ✗ | Sep 14 ✓ |

```ts
export const DAY_START_MIN  = 4 * 60;           // 04:00 IST
export const CUTOFF_MIN     = 19 * 60 + 30;     // 19:30 IST wall clock
export const CUTOFF_ELAPSED = (CUTOFF_MIN - DAY_START_MIN + 1440) % 1440;  // 930

export function elapsed(d = new Date()) {
  return (istMinutes(d) - DAY_START_MIN + 1440) % 1440;
}
export function fulfilDay(d = new Date()) {
  const today = businessDay(d);
  return elapsed(d) < CUTOFF_ELAPSED ? today : addDays(today, 1);
}
```

**Stock is per day:**

```prisma
model DayStock {
  productId   String
  day         String    @db.Char(10)
  planned     Float     @default(0)  // kg expected — the pre-order cap
  declared    Float     @default(0)  // kg that landed — the truth
  reserved    Float     @default(0)  // kg held by live orders
  sold        Float     @default(0)  // kg handed over — never undone
  declaredAt  DateTime?              // null = not declared; also orders the rail
  pricePerKg  Float                  // price belongs to the catch, not the product
  @@unique([productId, day])
}
```

`pricePerKg` lives here because fish price moves with the catch — pinning it to the day means an order's price is provably the one displayed, and yesterday's price never leaks into today.

| Row | Sold against | Storefront |
|---|---|---|
| Today, `declaredAt` set | `declared − reserved` | Buyable, "Landed today" |
| Today, not yet declared | nothing | "Landing now — back by 6 AM" |
| Tomorrow, `planned` > 0 | `planned − reserved` | Pre-order, "Delivered tomorrow" |
| Any earlier day | nothing, ever | Gone at 04:00 |

**Consequence of dropping Day 2:** between 04:00 and the declaration, today has nothing to sell. Correct, but must be designed: storefront shows a "landing now" state and keeps tomorrow's pre-orders open, and the admin gets a push at 05:00 if today is still undeclared.

**Declare, don't increment.** A stock entry states what is physically on ice. Saving twice is harmless; a mid-day top-up is the same gesture. Invariant `declared ≥ sold` — you cannot un-sell fish. `declared` *may* fall below `reserved`; that is what raises a short-fall.

**Atomic reservation** — guard in the `WHERE` clause inside a real `$transaction`, against `declared` (today) or `planned` (future), chosen server-side. Useful property: when `declared < reserved`, the guard goes negative and new sales of that fish stop automatically until the short-fall resolves. Delete `mongoose-mock.ts`.

## R2 — When the catch is short

Four facts that constrain any rule: the money moved first (Razorpay is upfront, so it's always a refund question); an unresolved short-fall is the worst outcome, so resolution cannot depend on the admin being awake; only the customer can accept a substitute; partial fish is sometimes fine and sometimes insulting.

**The rules:**

1. **FIFO by `paidAt`.** The only allocation people find fair without explanation. Pro-rata is worse — it turns one disappointed customer into five partly-disappointed ones and five partial refunds.
2. **Part-fill only if it covers ≥ half the order and ≥ `minOrderKg`.** Otherwise refund in full and pass the fish down the queue. This is what stops a 5 kg order swallowing a 1.2 kg catch and starving the 0.5 kg order behind it.
3. **Allocate against `declared − sold`,** never `declared`. Delivered fish can't be clawed back.
4. **Customer chooses, a clock guarantees the money moves.** Push immediately with three options (part-fill, substitute, cancel); a scheduled job auto-refunds anything unanswered at 08:00.
5. **Substitutes are offered at the original line total or less, never more.** Cheaper → refund the difference. Dearer → shop absorbs it or doesn't offer it.
6. **Every refund idempotent and logged.** Unique on `(orderItemId, reason)` plus Razorpay idempotency. Store `OrderItem.fulfilledKg` and `refundedAmount`; add `'Partial'` to `refundStatus`.

```ts
function allocate(declared, sold, orders /* paidAt asc */, minOrderKg) {
  let rem = declared - sold;
  for (const o of orders) {
    const need = Math.max(minOrderKg, 0.5 * o.kg);
    const give = Math.min(o.kg, rem);
    if (give >= o.kg)      { o.state = 'FULL';    o.filled = o.kg; }
    else if (give >= need) { o.state = 'PARTIAL'; o.filled = give; }
    else                   { o.state = 'SHORT';   o.filled = 0;    }
    rem -= o.filled;
  }
  return { orders, leftover: rem };   // leftover goes on general sale today
}
```

Verified over 30,000 randomised mornings with zero invariant violations. Worked cases:

| Case | Landed | Orders (oldest first) | Outcome | Leftover |
|---|---|---|---|---|
| A covers it | 12.0 | 2.0 · 3.0 · 1.5 | all FULL | 5.5 on sale |
| B clean cut | 4.0 | 2.0 · 2.0 · 2.0 | FULL · FULL · refund | 0 |
| C stub remainder | 4.3 | 2.0 · 2.0 · 2.0 | FULL · FULL · refund (0.3 < half of 2.0) | 0.3 on sale |
| E big order would starve queue | 1.2 | 5.0 · 0.5 | refund · FULL — Rule 2 passes the fish down | 0.7 on sale |
| F half-fill acceptable | 3.0 | 5.0 · 1.0 | PARTIAL 3.0 (40% refunded) · refund | 0 |

Case E is the one to stare at: strict FIFO gives two unhappy customers; Rule 2 gives one clean refund, one perfect delivery, and 0.7 kg left to sell.

**Situations the rules survive:**

- *More landed than planned* — nothing special; `planned` caps pre-orders, not the catch.
- *Admin re-declares lower at noon* — allocation re-runs against `declared − sold`; only orders whose allocation dropped and that haven't been notified get a push (`shortfallNotifiedAt` per item).
- *Customer answers after 08:00* — refund already issued; shown as "already refunded" with a reorder link. No double refund.
- *New orders during an unresolved short-fall* — blocked automatically by the negative guard; capacity reopens as refunds release `reserved`.
- *No catch at all* — one **"No catch today"** button zeroes every product and fires the whole flow.
- *Customer cancels before landing* — free and instant, releases `reserved`.
- *Short-fall on one line of a multi-fish order* — resolved per line; the rest ships.

**What the admin actually has to do: declare the catch.** Allocation runs, pushes go out, refunds land at 08:00 whether or not anyone opens the dashboard. The short-fall panel exists so a substitute *can* be offered, not because the system needs it.

## R3 — Admin: one sheet, two columns, one save

`/admin/stock` becomes the admin landing page. The 16-field form moves to `/admin/products/[id]` as "Edit details".

- Sorts by attention: **short-fall** → **not declared today** → **done**.
- Two kg numbers per row (today, tomorrow). **Tomorrow is pre-filled from a rolling median** of that fish's recent declarations — confirming a number, not inventing one. That's the difference between a column that gets maintained and one that goes stale.
- `inputMode="decimal"`, 44px targets, "Same as yesterday", "Nothing today", "No catch today" at the top, price behind a chevron.
- One sticky "Save N changes" → one `POST /api/admin/stock-day` `{ day, rows: [...] }` in one transaction; declarative so retries are safe. The response returns the allocation result, so the short-fall banner appears in the same round trip.
- Optimistic UI + rollback; 10-second Undo (which also rescinds an allocation — hence the 08:00 refund deadline rather than immediate); unsaved edits in `localStorage` keyed by business day.
- **One `StockRow` component**, grid template switches at the breakpoint — not a separate card list and table.
- AI agent returns a **draft** that pre-fills dirty rows for review instead of writing to the DB.

## R4 — Nutrition

- `nutrition Json?` on Product, Zod `NutritionSchema` validated both directions; renderer `safeParse`s and shows nothing rather than something broken.
- Per 100 g raw: energyKcal, protein, fat, saturatedFat, omega3Mg, cholesterolMg, sodiumMg, calciumMg, ironMg, vitaminDMcg, vitaminB12Mcg, seleniumMcg, highlights[≤3], note.
- Ship `nutrition-defaults.ts` keyed by slug; `db:import-fish` fills empty columns so nothing launches blank.
- Editor in Edit details → Nutrition tab, with "copy from another fish".
- Customer panel between description and reviews: four macro tiles (protein / energy / fat / **omega-3 as hero**, vs catalog median), highlight chips, micros in `<details>`. CSS bars with `aria-label`, `tabular-nums`, no chart library. Fine print: indicative, raw, not medical advice.

## R5 — Sign-in: three keys, Firebase at the gate

**Firebase proves the phone, NextAuth owns the session.** OTP exists in a local directory, not on `main`, so this is the contract it must meet.

| Field | Required | Unique | Rules |
|---|---|---|---|
| username | yes | yes | 3–20, `a-z 0-9 . _`, lowercase, **never all digits**, reserve admin/aquacart/support/api |
| phone | yes | yes | canonical `+91XXXXXXXXXX`, normalized on every write |
| phoneVerifiedAt | yes | — | set only by the server after `verifyIdToken`; the login gate |
| email | no | when present | MySQL allows many NULLs in a unique index; shape validation only |
| password | yes | — | bcrypt; drop all `*VerificationToken` / `tempEmail*` columns |

**Signup order:** (1) duplicate check **before** the SMS — never spend an OTP on a known duplicate; (2) client `signInWithPhoneNumber` → `confirm()` → ID token; (3) server `verifyIdToken`, then assert `phone_number` equals the submitted canonical phone, `aud` is your project, `auth_time` within 10 min, phone unclaimed; (4) create user with `phoneVerifiedAt`, `signOut()` the Firebase client.

**Two things to check in the local branch:** no client-supplied `verified: true` is trusted anywhere; and **SMS toll fraud** mitigations — App Check on, region restricted to India, daily SMS cap, availability endpoint rate-limited per IP.

**Login** — `classify(raw)`: contains `@` → email; 10–13 digits after stripping punctuation → phone (`+91` + last 10); otherwise username. The "no all-digit usernames" rule keeps this unambiguous. Dummy bcrypt compare on miss so timing doesn't leak existence.

**Password reset** reuses the Firebase OTP. Keep an audit-logged admin-issued reset for the number-changed case.

**Delete:** `api/verify-email`, `api/verify-otp`, `api/resend-otp`, `(auth)/verify-email`, `VerifyEmailForm`, `sendVerificationEmail`, `ALLOWED_EMAIL_DOMAINS`. `Order.customerEmail` nullable; `customerPhone` is the contact of record.

## R6 — Alerts and moment marketing

**Admin — new order.** Fire the existing role-gated WSS from the **Razorpay webhook** (it still arrives when the customer closes the tab). Authenticate `/broadcast` first. Reconnect with backoff and **refetch orders since last seen id** — a socket alone drops everything that happened while the laptop slept. Same channel carries the 05:00 "still undeclared" nudge and short-fall notices.

**Customer — order tracking.** FCM web push, same Firebase project. `firebase-messaging-sw.js`, VAPID key, `getToken()` only after explicit opt-in. `PushDevice { userId, token, platform, createdAt, lastSeenAt }`, pruned on `registration-token-not-registered`. Fire on `ORDER_STATUS` transitions plus payment failure and short-fall, idempotent on `(orderId, status)`, deep-linked. iOS needs the PWA installed to home screen (16.4+).

**Moment marketing — the declaration is the moment.** "வஞ்சிரம் just landed — 12 kg. ₹1,200/kg · order before 7:30 PM for delivery today."

- Opt-in by intent: "Notify me when this lands" + per-category subs. `CatchAlert { userId, productId?, category? }`. Doubles as demand data for tomorrow's `planned`.
- Second moment: reorder nudge from `OrderItem` history.
- Guardrails: one marketing push per user per day, quiet hours 21:00–06:00 IST, marketing consent stored **separately** from transactional.
- Queue it: `NotificationJob` rows in the same transaction as the declaration, drained by a scheduled function.

The 19:30 cutoff makes "order before 7:30 PM" a true deadline rather than a growth tactic.

## 07 — Delivery slots (explainer)

A **delivery slot** is a named time window a customer picks at checkout (07:00–10:00, 17:00–20:00) with a limit on how many orders it holds. Two ideas inside it: *telling the customer when*, and *capping how many*.

Why it comes up: fresh fish needs someone home; a 19:30 cutoff already implies more than one run per day (an 08:00 order and a 19:00 order can't be on the same trip); and one rider on one round carries maybe 25 orders — without a cap, the 40th order is accepted and then disappoints, the same failure as overselling stock in a different dimension.

- **Now:** `Order.slot` as `'MORNING' | 'EVENING'`, derived from the same elapsed-minutes function that picks `fulfilDay`. One column, no new UI, and the customer sees "Arriving tomorrow, 7–10 AM" instead of a vague "tomorrow". Worth doing in Phase 1.
- **Later:** `DeliverySlot { day, slot, capacity, booked }` reserved at checkout with the same conditional update that guards stock (`WHERE booked < capacity`); unavailable slots grey out. Build when you start turning orders away.

Avoid offering a choice of windows without a capacity cap — that reads as a promise and behaves as a guess.

## Build order

1. **Foundations** — kilos, `DayStock` + `StockLog` + `Order.fulfilDay` + `Order.slot`, `business-day.ts` on elapsed minutes with tests pinned to the midnight–04:00 window, real transactions, conditional-update reservation, authenticate `/broadcast`.
2. **Identity** — merge the local OTP branch against the R5 contract; schema reshape, `classify()`, one-field login, availability-before-OTP, Firebase-verified reset, App Check + IN region lock. Reseed.
3. **Sheet & short-fall** — these ship together; a declaration screen without short-fall handling can take money it can't honour. `/admin/stock`, bulk API returning the allocation, 08:00 auto-refund job, substitute offers, "No catch today", storefront states.
4. **Alerts** — admin WS alerts off the webhook, 05:00 nudge, FCM + `PushDevice`, `CatchAlert` + `NotificationJob` with caps and quiet hours.
5. **Nutrition** — column, Zod, defaults, admin tab, product-page panel. Independent; can slip.

## Still open

1. **The 08:00 refund deadline** — should move earlier if the morning round leaves earlier.
2. **The 50% part-fill threshold** — rarely fires if customers order ~1 kg; fires often if they order for functions.
3. **Does the physical shop share this stock?** If walk-in customers buy from the same ice, `declared` stops being true and the admin needs a quick "sold 3 kg at the counter" adjustment — otherwise online customers get promised fish that already walked out the door. The one thing that could still surprise you.
4. **Delivery radius and charge** — not modelled anywhere yet; interacts with slots.
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  addDays,
  businessDay,
  fulfilDay,
  type BusinessDay,
} from './business-day';
import {
  allocate,
  linesNeedingNotice,
  roundKg,
  type AllocationLine,
  type AllocationOutcome,
} from './allocation';
import {
  FULFILMENT_STATE,
  NOTIFICATION_KIND,
  NOTIFICATION_TOPIC,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PLANNED_MEDIAN_WINDOW_DAYS,
} from './constants';

/**
 * Everything that reads or moves kilograms.
 *
 * The one idea to hold on to: stock is a property of (fish, business day), not
 * of the fish. There is no "current stock" anywhere in this file, because
 * there is no such thing — there is today's catch, and tomorrow's plan, and
 * yesterday's row which stopped being sellable at 04:00 without anyone
 * touching it.
 */

export type Tx = Prisma.TransactionClient;

/** Which number caps sales for a given day. */
export type StockBasis = 'declared' | 'planned';

/**
 * Today sells against what actually landed; a future day sells against what is
 * planned. Chosen here, on the server, from the day alone — never sent by the
 * client, which would let a caller pre-order against a catch that is already
 * on ice and spoken for.
 */
export function basisFor(day: BusinessDay, now: Date = new Date()): StockBasis {
  return day === businessDay(now) ? 'declared' : 'planned';
}

export const STOREFRONT_STATE = {
  /** Declared and there is fish left. */
  AVAILABLE: 'AVAILABLE',
  /** Today's row exists but has not been declared yet. */
  LANDING: 'LANDING',
  /** Tomorrow's row has a plan; buying now is a pre-order. */
  PREORDER: 'PREORDER',
  /** Declared (or planned) but every kilo is spoken for. */
  SOLD_OUT: 'SOLD_OUT',
  /** Nothing planned, nothing landed, or the fish is delisted. */
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type StorefrontState =
  (typeof STOREFRONT_STATE)[keyof typeof STOREFRONT_STATE];

export interface StockView {
  productId: string;
  day: BusinessDay;
  basis: StockBasis;
  state: StorefrontState;
  /** Kilograms a customer can buy right now. Never negative. */
  sellableKg: number;
  pricePerKg: number;
  declaredAt: Date | null;
}

interface DayStockish {
  productId: string;
  day: string;
  planned: number;
  declared: number;
  reserved: number;
  sold: number;
  declaredAt: Date | null;
  pricePerKg: number;
}

/**
 * Turn a DayStock row into what the storefront should show.
 *
 * | Row                      | Sold against         | Shown as              |
 * |--------------------------|----------------------|-----------------------|
 * | Today, declaredAt set    | declared − reserved  | "Landed today"        |
 * | Today, not yet declared  | nothing              | "Landing now"         |
 * | Tomorrow, planned > 0    | planned − reserved   | "Delivered tomorrow"  |
 * | Any earlier day          | nothing, ever        | gone at 04:00         |
 *
 * Between 04:00 and the declaration, today genuinely has nothing to sell. That
 * is a correct consequence of dropping Day 2, not a bug — but it has to be a
 * designed state rather than an empty shelf, which is what LANDING is for.
 */
export function viewFor(
  row: DayStockish | null,
  day: BusinessDay,
  opts: { availability?: boolean; basePricePerKg?: number; now?: Date } = {}
): StockView {
  const now = opts.now ?? new Date();
  const basis = basisFor(day, now);
  const base = {
    productId: row?.productId ?? '',
    day,
    basis,
    declaredAt: row?.declaredAt ?? null,
    pricePerKg: row?.pricePerKg ?? opts.basePricePerKg ?? 0,
  };

  if (opts.availability === false || !row) {
    return { ...base, state: STOREFRONT_STATE.UNAVAILABLE, sellableKg: 0 };
  }

  if (basis === 'declared') {
    if (!row.declaredAt) {
      return { ...base, state: STOREFRONT_STATE.LANDING, sellableKg: 0 };
    }
    // Clamp: when declared < reserved the pool is negative, which is exactly
    // the short-fall condition. Sales stop on their own until refunds release
    // the reservation — no flag, no admin action.
    const sellable = Math.max(0, roundKg(row.declared - row.reserved));
    return {
      ...base,
      state: sellable > 0 ? STOREFRONT_STATE.AVAILABLE : STOREFRONT_STATE.SOLD_OUT,
      sellableKg: sellable,
    };
  }

  if (row.planned <= 0) {
    return { ...base, state: STOREFRONT_STATE.UNAVAILABLE, sellableKg: 0 };
  }
  const sellable = Math.max(0, roundKg(row.planned - row.reserved));
  return {
    ...base,
    state: sellable > 0 ? STOREFRONT_STATE.PREORDER : STOREFRONT_STATE.SOLD_OUT,
    sellableKg: sellable,
  };
}

/** The stock view for every listed product, for the day orders now land on. */
export async function storefrontStock(now: Date = new Date()) {
  const day = fulfilDay(now);
  const products = await prisma.product.findMany({
    where: { availability: true },
    include: { dayStocks: { where: { day } } },
    orderBy: { name: 'asc' },
  });

  return products.map((p) => ({
    product: p,
    stock: viewFor(p.dayStocks[0] ?? null, day, {
      availability: p.availability,
      basePricePerKg: p.basePricePerKg,
      now,
    }),
  }));
}

/** The stock view for one product, for the day orders now land on. */
export async function stockForProduct(productId: string, now: Date = new Date()) {
  const day = fulfilDay(now);
  const [product, row] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.dayStock.findUnique({ where: { productId_day: { productId, day } } }),
  ]);
  if (!product) return null;
  return {
    product,
    stock: viewFor(row, day, {
      availability: product.availability,
      basePricePerKg: product.basePricePerKg,
      now,
    }),
  };
}

/**
 * Hold `kg` of a fish for a day, atomically.
 *
 * The guard lives in the WHERE clause, so the check and the write are one
 * statement and two simultaneous checkouts cannot both pass it. Returns false
 * when the row was not updated — which means either there is not enough left
 * or the row does not exist. Both are "you cannot have it", and the caller
 * must abort the transaction.
 *
 * This replaces the old read-then-`$inc`-then-check-afterwards pattern, which
 * could oversell and then tried to unwind by throwing inside a transaction
 * that was never real.
 */
export async function reserveKg(
  tx: Tx,
  productId: string,
  day: BusinessDay,
  kg: number,
  basis: StockBasis
): Promise<boolean> {
  const want = roundKg(kg);
  if (want <= 0) return false;

  const affected =
    basis === 'declared'
      ? await tx.$executeRaw`
          UPDATE \`DayStock\`
             SET \`reserved\` = \`reserved\` + ${want},
                 \`updatedAt\` = NOW(3)
           WHERE \`productId\` = ${productId}
             AND \`day\` = ${day}
             AND \`declaredAt\` IS NOT NULL
             AND \`declared\` - \`reserved\` >= ${want}`
      : await tx.$executeRaw`
          UPDATE \`DayStock\`
             SET \`reserved\` = \`reserved\` + ${want},
                 \`updatedAt\` = NOW(3)
           WHERE \`productId\` = ${productId}
             AND \`day\` = ${day}
             AND \`planned\` - \`reserved\` >= ${want}`;

  return affected === 1;
}

/**
 * Give `kg` back to the pool — a cancellation, a failed payment, or a refunded
 * short-fall.
 *
 * `GREATEST(0, ...)` because a reservation released twice must not drive
 * `reserved` negative, which would silently inflate what the storefront thinks
 * is available.
 */
export async function releaseKg(
  tx: Tx,
  productId: string,
  day: BusinessDay,
  kg: number
): Promise<void> {
  const give = roundKg(kg);
  if (give <= 0) return;
  await tx.$executeRaw`
    UPDATE \`DayStock\`
       SET \`reserved\` = GREATEST(0, \`reserved\` - ${give}),
           \`updatedAt\` = NOW(3)
     WHERE \`productId\` = ${productId}
       AND \`day\` = ${day}`;
}

/** Move kilograms from reserved to sold when an order is handed over. */
export async function markSoldKg(
  tx: Tx,
  productId: string,
  day: BusinessDay,
  kg: number
): Promise<void> {
  const amount = roundKg(kg);
  if (amount <= 0) return;
  await tx.$executeRaw`
    UPDATE \`DayStock\`
       SET \`sold\` = \`sold\` + ${amount},
           \`reserved\` = GREATEST(0, \`reserved\` - ${amount}),
           \`updatedAt\` = NOW(3)
     WHERE \`productId\` = ${productId}
       AND \`day\` = ${day}`;
}

/**
 * The order lines competing for one fish on one day, oldest payment first.
 *
 * Only paid, uncancelled lines are here: an order still sitting in the
 * Razorpay modal has reserved its fish but has not committed, and giving it a
 * FIFO position ahead of someone who has actually paid would be wrong.
 */
export async function competingLines(
  tx: Tx,
  productId: string,
  day: BusinessDay
) {
  return tx.orderItem.findMany({
    where: {
      productId,
      order: {
        fulfilDay: day,
        paymentStatus: PAYMENT_STATUS.PAID,
        orderStatus: { not: ORDER_STATUS.CANCELLED },
      },
    },
    include: { order: { select: { id: true, paidAt: true, orderStatus: true } } },
  });
}

export interface DeclarationRow {
  productId: string;
  /** kg that landed. Omit to leave the declaration untouched. */
  declared?: number;
  /** kg expected. Omit to leave the plan untouched. */
  planned?: number;
  /** ₹ per kg for this day's catch. Omit to keep the current price. */
  pricePerKg?: number;
}

export interface ProductAllocation {
  productId: string;
  productName: string;
  outcome: AllocationOutcome;
  /** Lines that need a fresh short-fall push. */
  toNotify: string[];
}

export interface DeclarationResult {
  day: BusinessDay;
  saved: number;
  allocations: ProductAllocation[];
  /** True when any product came up short. Drives the admin banner. */
  hasShortfall: boolean;
}

/**
 * Declare what is on ice, and settle every order against it. One transaction.
 *
 * DECLARE, DON'T INCREMENT. A row states what physically landed, so saving the
 * same number twice is a no-op and a mid-day top-up is the same gesture as the
 * first declaration. The old `{ increment }` sync had the opposite property:
 * pressing Sync twice doubled the stock.
 *
 * The invariant is `declared >= sold` — you cannot un-sell a fish that is
 * already in someone's kitchen. `declared` *may* fall below `reserved`; that
 * is not an error, it is the definition of a short-fall, and it is what makes
 * the reservation guard go negative and stop new sales on its own.
 */
export async function declareStock(
  rows: DeclarationRow[],
  day: BusinessDay,
  opts: { actorId?: string | null; source?: string; now?: Date } = {}
): Promise<DeclarationResult> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? 'admin';
  const isToday = day === businessDay(now);

  return prisma.$transaction(async (tx) => {
    const productIds = rows.map((r) => r.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, minOrderKg: true, basePricePerKg: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const existing = await tx.dayStock.findMany({
      where: { day, productId: { in: productIds } },
    });
    const existingByProduct = new Map(existing.map((r) => [r.productId, r]));

    const allocations: ProductAllocation[] = [];
    let saved = 0;

    for (const row of rows) {
      const product = productById.get(row.productId);
      if (!product) continue;
      const before = existingByProduct.get(row.productId) ?? null;

      const nextDeclared =
        row.declared !== undefined ? roundKg(row.declared) : before?.declared ?? 0;
      const nextPlanned =
        row.planned !== undefined ? roundKg(row.planned) : before?.planned ?? 0;
      const nextPrice =
        row.pricePerKg !== undefined
          ? row.pricePerKg
          : before?.pricePerKg ?? product.basePricePerKg;

      if (nextDeclared < (before?.sold ?? 0)) {
        throw new DeclarationError(
          `${product.name}: ${nextDeclared} kg is less than the ${before?.sold} kg already delivered.`
        );
      }

      // A declaration is the act of saying "this landed" — so declaredAt is
      // set whenever the admin submits a declared figure for today, including
      // an explicit zero ("nothing today"). Without the explicit-zero case,
      // "no catch" would be indistinguishable from "not looked at yet" and the
      // storefront would sit in LANDING forever.
      const declaring = isToday && row.declared !== undefined;
      const declaredAt = declaring ? before?.declaredAt ?? now : before?.declaredAt ?? null;

      const data = {
        planned: nextPlanned,
        declared: nextDeclared,
        pricePerKg: nextPrice,
        declaredAt,
      };

      const after = await tx.dayStock.upsert({
        where: { productId_day: { productId: row.productId, day } },
        create: { productId: row.productId, day, ...data },
        update: data,
      });
      saved += 1;

      // Audit only what moved. Logging unchanged fields would bury the one
      // line that answers "who dropped the price at 6pm".
      const logs: Prisma.StockLogCreateManyInput[] = [];
      const track = (field: string, from: number | undefined, to: number) => {
        if (from === undefined || Math.abs(from - to) > 1e-9) {
          logs.push({
            productId: row.productId,
            day,
            field,
            fromValue: from ?? null,
            toValue: to,
            actorId: opts.actorId ?? null,
            source,
          });
        }
      };
      if (row.declared !== undefined) track('declared', before?.declared, nextDeclared);
      if (row.planned !== undefined) track('planned', before?.planned, nextPlanned);
      if (row.pricePerKg !== undefined) track('pricePerKg', before?.pricePerKg, nextPrice);
      if (logs.length) await tx.stockLog.createMany({ data: logs });

      if (!declaring) continue;

      // ---- Settle the order book against what actually landed. ----
      const items = await competingLines(tx, row.productId, day);
      const lines: AllocationLine[] = items.map((item) => ({
        id: item.id,
        kg: item.kg,
        paidAt: item.order.paidAt,
        // Delivered fish and accepted part-fills are immovable. They still
        // consume their share in FIFO position so later lines see a truthful
        // pool, but a re-declaration must never restate them.
        locked:
          item.order.orderStatus === ORDER_STATUS.DELIVERED ||
          item.fulfilmentState === FULFILMENT_STATE.CANCELLED ||
          item.choiceAt !== null,
        lockedKg: item.fulfilledKg,
      }));

      const outcome = allocate({
        declared: nextDeclared,
        sold: after.sold,
        lines,
        minOrderKg: product.minOrderKg,
      });

      const previous = new Map(
        items.map((i) => [
          i.id,
          { fulfilledKg: i.fulfilledKg, notifiedAt: i.shortfallNotifiedAt },
        ])
      );
      const notify = linesNeedingNotice(outcome, previous);

      for (const line of outcome.lines) {
        if (line.locked) continue;
        await tx.orderItem.update({
          where: { id: line.id },
          data: { fulfilledKg: line.fulfilledKg, fulfilmentState: line.state },
        });
      }

      await tx.dayStock.update({
        where: { productId_day: { productId: row.productId, day } },
        data: { allocatedAt: now },
      });

      // Queue the pushes in the SAME transaction as the declaration, so a
      // notification can never describe a catch that failed to save.
      if (notify.length) {
        const byId = new Map(items.map((i) => [i.id, i]));
        await tx.notificationJob.createMany({
          data: notify.map((line) => {
            const item = byId.get(line.id)!;
            return {
              kind: NOTIFICATION_KIND.TRANSACTIONAL,
              topic: NOTIFICATION_TOPIC.SHORTFALL,
              userId: null,
              payload: {
                orderId: item.orderId,
                orderItemId: line.id,
                productName: product.name,
                orderedKg: line.kg,
                fulfilledKg: line.fulfilledKg,
                state: line.state,
              } as Prisma.InputJsonValue,
              dedupeKey: `SHORTFALL:${line.id}:${day}:${line.fulfilledKg}`,
            };
          }),
          skipDuplicates: true,
        });
        await tx.orderItem.updateMany({
          where: { id: { in: notify.map((l) => l.id) } },
          data: { shortfallNotifiedAt: now },
        });
      }

      // The moment worth marketing is the declaration itself.
      if (nextDeclared > 0 && !before?.declaredAt) {
        await tx.notificationJob.create({
          data: {
            kind: NOTIFICATION_KIND.MARKETING,
            topic: NOTIFICATION_TOPIC.CATCH_LANDED,
            payload: {
              productId: row.productId,
              productName: product.name,
              kg: nextDeclared,
              pricePerKg: nextPrice,
              day,
            } as Prisma.InputJsonValue,
            dedupeKey: `CATCH_LANDED:${row.productId}:${day}`,
          },
        });
      }

      allocations.push({
        productId: row.productId,
        productName: product.name,
        outcome,
        toNotify: notify.map((l) => l.id),
      });
    }

    return {
      day,
      saved,
      allocations,
      hasShortfall: allocations.some((a) => a.outcome.isShort),
    };
  });
}

/** Raised when a declaration would violate `declared >= sold`. */
export class DeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarationError';
  }
}

/**
 * The number to pre-fill tomorrow's column with.
 *
 * A rolling median of recent declarations, not a mean: one exceptional haul
 * should not drag the suggestion up for a fortnight. Confirming a number is a
 * different act from inventing one, and it is the difference between a column
 * that gets maintained and one that goes stale.
 */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function plannedSuggestions(
  day: BusinessDay,
  windowDays = PLANNED_MEDIAN_WINDOW_DAYS
): Promise<Map<string, number>> {
  const from = addDays(day, -windowDays);
  const history = await prisma.dayStock.findMany({
    where: { day: { gte: from, lt: day }, declaredAt: { not: null } },
    select: { productId: true, declared: true },
  });

  const byProduct = new Map<string, number[]>();
  for (const row of history) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row.declared);
    byProduct.set(row.productId, list);
  }

  const out = new Map<string, number>();
  for (const [productId, values] of byProduct) {
    out.set(productId, roundKg(median(values)));
  }
  return out;
}

/**
 * The admin sheet's data: every listed fish with today's and tomorrow's rows,
 * sorted by attention — short-fall first, then undeclared, then done.
 */
export async function stockSheet(now: Date = new Date()) {
  const today = businessDay(now);
  const tomorrow = addDays(today, 1);

  const [products, rows, suggestions] = await Promise.all([
    prisma.product.findMany({
      where: { availability: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameTamil: true,
        slug: true,
        imageUrl: true,
        category: true,
        minOrderKg: true,
        basePricePerKg: true,
      },
    }),
    prisma.dayStock.findMany({ where: { day: { in: [today, tomorrow] } } }),
    plannedSuggestions(tomorrow),
  ]);

  const byKey = new Map(rows.map((r) => [`${r.productId}|${r.day}`, r]));

  const sheet = products.map((product) => {
    const todayRow = byKey.get(`${product.id}|${today}`) ?? null;
    const tomorrowRow = byKey.get(`${product.id}|${tomorrow}`) ?? null;
    const shortfallKg = todayRow
      ? Math.max(0, roundKg(todayRow.reserved - todayRow.declared))
      : 0;

    return {
      product,
      today: {
        day: today,
        declared: todayRow?.declared ?? null,
        reserved: todayRow?.reserved ?? 0,
        sold: todayRow?.sold ?? 0,
        pricePerKg: todayRow?.pricePerKg ?? product.basePricePerKg,
        declaredAt: todayRow?.declaredAt ?? null,
      },
      tomorrow: {
        day: tomorrow,
        planned: tomorrowRow?.planned ?? null,
        reserved: tomorrowRow?.reserved ?? 0,
        pricePerKg: tomorrowRow?.pricePerKg ?? product.basePricePerKg,
        /** What to pre-fill an empty tomorrow with. */
        suggested: suggestions.get(product.id) ?? 0,
      },
      shortfallKg,
      /** 0 short-fall, 1 undeclared, 2 done — the sort key. */
      attention: shortfallKg > 0 ? 0 : todayRow?.declaredAt ? 2 : 1,
    };
  });

  sheet.sort(
    (a, b) => a.attention - b.attention || a.product.name.localeCompare(b.product.name)
  );
  return { today, tomorrow, rows: sheet };
}

/** Products with a declared catch today that still have fish left to sell. */
export async function leftoverToday(now: Date = new Date()) {
  const day = businessDay(now);
  const rows = await prisma.dayStock.findMany({
    where: { day, declaredAt: { not: null } },
    include: { product: { select: { name: true, slug: true } } },
  });
  return rows
    .map((r) => ({ ...r, leftover: roundKg(r.declared - r.reserved - r.sold) }))
    .filter((r) => r.leftover > 0);
}

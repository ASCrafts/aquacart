import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { addDays, businessDay, type BusinessDay } from '@/lib/business-day';
import { ROLES } from '@/lib/constants';
import {
  DeclarationError,
  declareStock,
  stockSheet,
  type DeclarationResult,
  type DeclarationRow,
} from '@/lib/stock';

/**
 * The admin sheet's only endpoint: read the morning, then save it in one go.
 *
 * GET  -> stockSheet(), plus yesterday's landings so the sheet can offer
 *         "Same as yesterday" without a second round trip.
 * POST -> { day, rows } -> declareStock(), and the allocation result comes
 *         back in the SAME response so the short-fall banner can render
 *         immediately instead of after a follow-up fetch. That matters: the
 *         admin needs to know a customer is about to be refunded while they
 *         are still looking at the number they just typed.
 *
 * Everything here is DECLARATIVE. A row says "this is what landed", never
 * "add this much", so a retry after a dropped connection re-states the same
 * facts and changes nothing. That is what lets the client save optimistically
 * and re-post on undo.
 */

// Never cached, and never prerendered: this reads the session and today's
// kilos, both of which are meaningless outside a live request.
export const dynamic = 'force-dynamic';

/** Biggest catch we will accept for one fish on one day, in kg. */
const MAX_KG = 5_000;
/** Sanity cap on ₹/kg, so a slipped decimal is rejected rather than charged. */
const MAX_PRICE = 100_000;
/** The catalog is tens of fish, not thousands. A bigger body is a bug or an attack. */
const MAX_ROWS = 500;

function forbidden() {
  return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
}

/**
 * Yesterday's declared kilos per product.
 *
 * Deliberately duplicated (the same six lines live in the /admin/stock page)
 * rather than pushed into src/lib/stock.ts, which is another group's file.
 * Only rows that were actually declared count: a row nobody touched yesterday
 * has `declared` 0, and offering 0 as "same as yesterday" would quietly
 * declare a no-catch.
 */
async function yesterdayDeclared(today: BusinessDay): Promise<Record<string, number>> {
  const rows = await prisma.dayStock.findMany({
    where: { day: addDays(today, -1), declaredAt: { not: null } },
    select: { productId: true, declared: true },
  });
  return Object.fromEntries(rows.map((r) => [r.productId, r.declared]));
}

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== ROLES.ADMIN) return forbidden();

  try {
    const sheet = await stockSheet();
    const yesterday = await yesterdayDeclared(sheet.today);
    return NextResponse.json({ ...sheet, yesterday });
  } catch (error) {
    console.error('[stock-day] GET failed:', error);
    return NextResponse.json({ message: 'Could not load the sheet.' }, { status: 500 });
  }
}

interface IncomingRow {
  productId: string;
  declared?: number;
  planned?: number;
  pricePerKg?: number;
}

/**
 * Accept a number only if it is a real, finite, in-range quantity.
 *
 * `undefined` is a meaningful answer here — it means "leave this field alone",
 * which is how the sheet sends a row where only one of the two columns moved.
 * `null`, NaN, Infinity and negatives are not answers, they are rejections.
 */
function optionalNumber(value: unknown, max: number, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequest(`${label} must be a number.`);
  }
  if (value < 0 || value > max) {
    throw new BadRequest(`${label} must be between 0 and ${max}.`);
  }
  return value;
}

class BadRequest extends Error {}

function parseBody(body: unknown): { day: BusinessDay; rows: IncomingRow[] } {
  if (!body || typeof body !== 'object') throw new BadRequest('Expected a JSON body.');
  const { day, rows } = body as { day?: unknown; rows?: unknown };

  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequest('day must be a business day, "YYYY-MM-DD".');
  }
  if (!Array.isArray(rows)) throw new BadRequest('rows must be an array.');
  if (rows.length === 0) throw new BadRequest('Nothing to save.');
  if (rows.length > MAX_ROWS) throw new BadRequest('Too many rows in one save.');

  const parsed = rows.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new BadRequest('Each row must be an object.');
    const { productId, declared, planned, pricePerKg } = raw as Record<string, unknown>;
    if (typeof productId !== 'string' || !productId) {
      throw new BadRequest('Each row needs a productId.');
    }
    return {
      productId,
      declared: optionalNumber(declared, MAX_KG, 'declared'),
      planned: optionalNumber(planned, MAX_KG, 'planned'),
      pricePerKg: optionalNumber(pricePerKg, MAX_PRICE, 'pricePerKg'),
    };
  });

  return { day, rows: parsed };
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.role !== ROLES.ADMIN) return forbidden();

  let day: BusinessDay;
  let rows: IncomingRow[];
  try {
    ({ day, rows } = parseBody(await request.json().catch(() => null)));
  } catch (error) {
    const message = error instanceof BadRequest ? error.message : 'Malformed request.';
    return NextResponse.json({ message }, { status: 400 });
  }

  // The sheet only ever edits today and tomorrow, so the day it posts must be
  // the business day that is current ON THE SERVER. A tab left open overnight
  // still holds yesterday's date; accepting it would re-declare yesterday's
  // catch and re-run an allocation whose refunds have already been paid. 409
  // rather than 400: nothing is wrong with the request, the world moved.
  const today = businessDay();
  if (day !== today) {
    return NextResponse.json(
      {
        message: `The business day rolled over to ${today}. Reload the sheet before saving.`,
        today,
      },
      { status: 409 }
    );
  }
  const tomorrow = addDays(today, 1);

  // One sheet, two DayStock rows per fish: today's `declared` (and the price
  // today's orders are charged) live on today's row, tomorrow's `planned` on
  // tomorrow's. declareStock takes one day at a time, so the save splits — but
  // both halves are declarative, so the pair is still safe to retry whole.
  //
  // Order matters. The plan goes first because it settles nothing: if it
  // fails, no money has moved and the client simply keeps its draft. The
  // declaration goes last because it is the call that allocates the catch,
  // queues short-fall pushes and commits real refunds; a retry re-states the
  // plan as a no-op before reaching it.
  const todayRows: DeclarationRow[] = [];
  const tomorrowRows: DeclarationRow[] = [];
  for (const row of rows) {
    if (row.declared !== undefined || row.pricePerKg !== undefined) {
      todayRows.push({
        productId: row.productId,
        declared: row.declared,
        pricePerKg: row.pricePerKg,
      });
    }
    if (row.planned !== undefined) {
      tomorrowRows.push({ productId: row.productId, planned: row.planned });
    }
  }

  const actorId = session.user?.id ?? null;

  try {
    let saved = 0;
    if (tomorrowRows.length) {
      const plan = await declareStock(tomorrowRows, tomorrow, { actorId, source: 'admin' });
      saved += plan.saved;
    }

    const result: DeclarationResult = todayRows.length
      ? await declareStock(todayRows, today, { actorId, source: 'admin' })
      : { day: today, saved: 0, allocations: [], hasShortfall: false };
    saved += result.saved;

    // The fresh sheet rides along so the client can replace its optimistic
    // state with server truth — including the re-sort, since a fish that just
    // came up short belongs at the top of the page now.
    const sheet = await stockSheet();
    const yesterday = await yesterdayDeclared(sheet.today);

    return NextResponse.json({
      day: today,
      saved,
      result,
      hasShortfall: result.hasShortfall,
      sheet: { ...sheet, yesterday },
    });
  } catch (error) {
    // `declared < sold` is the admin's mistake to fix, not a server fault:
    // name the fish and the number so the sheet can say it out loud.
    if (error instanceof DeclarationError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    console.error('[stock-day] POST failed:', error);
    return NextResponse.json(
      { message: 'The save did not go through. Your numbers are still here — try again.' },
      { status: 500 }
    );
  }
}

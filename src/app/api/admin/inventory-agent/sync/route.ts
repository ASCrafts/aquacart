import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { businessDay } from '@/lib/business-day';
import type { InventoryDraftResponse, InventoryDraftRow } from '@/types/inventory-agent';

/**
 * "Sync" used to mean "write to the database" — that was drift bug #6
 * (artifact.md, section 00): it ran `prisma.product.update({ data: {
 * quantity: { increment }, stockKg: { increment } } })`, so pressing the
 * button twice doubled whatever the model had extracted. There is no fix to
 * that call, because incrementing was never the right operation in the first
 * place — R3's whole stock model is DECLARATIVE (see declareStock() in
 * src/lib/stock.ts: a row states what is physically on ice, so saving the
 * same number twice is a no-op).
 *
 * So this route no longer writes anything, ever. It takes whatever rows the
 * admin has reviewed and kept in MultimodalInventoryAgent (dropped rows never
 * reach here) and turns them into a validated DRAFT: real products only,
 * numbers clamped to sane bounds, matched to TODAY's business day as decided
 * by the server — never the client. The draft is written to sessionStorage
 * by the client and picked up by StockSheet.tsx's own declarative save
 * (POST /api/admin/stock-day -> declareStock()), which is the only place a
 * kilogram figure is ever allowed to reach the database. Declaring is
 * idempotent; incrementing never was.
 */

export const dynamic = 'force-dynamic';

/** Mirrors the caps in /api/admin/stock-day — a slipped decimal from OCR/ASR should be rejected, not charged. */
const MAX_KG = 5_000;
const MAX_PRICE = 100_000;
const MAX_ROWS = 100;

function forbidden() {
  return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
}

interface IncomingRow {
  productId?: unknown;
  slug?: unknown;
  name?: unknown;
  declaredKg?: unknown;
  declared?: unknown;
  pricePerKg?: unknown;
  confidence?: unknown;
  note?: unknown;
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user?.role !== ROLES.ADMIN) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Expected a JSON body.' }, { status: 400 });
  }

  const rawRows = Array.isArray(body)
    ? body
    : Array.isArray((body as { rows?: unknown })?.rows)
      ? (body as { rows: unknown[] }).rows
      : null;

  if (!rawRows) {
    return NextResponse.json({ message: 'Expected { rows: [...] }.' }, { status: 400 });
  }
  if (!rawRows.length) {
    return NextResponse.json({ message: 'No rows to review — nothing was kept.' }, { status: 400 });
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json({ message: 'Too many rows in one batch.' }, { status: 400 });
  }

  const day = businessDay();

  // Resolve every row against a REAL product — by id first, then by slug —
  // so a hallucinated productId or a stale slug from a previous session
  // cannot end up on the stock sheet as an editable draft row.
  const candidates = (rawRows as IncomingRow[]).filter(
    (r) => r && typeof r === 'object' && (typeof r.productId === 'string' || typeof r.slug === 'string')
  );
  const ids = candidates.map((r) => (typeof r.productId === 'string' ? r.productId : null)).filter(
    (v): v is string => !!v
  );
  const slugs = candidates.map((r) => (typeof r.slug === 'string' ? r.slug : null)).filter(
    (v): v is string => !!v
  );

  const products = await prisma.product.findMany({
    // Delisted fish are excluded: StockSheet's own sheet.rows never include
    // them either, so a row for one would sit in the draft unable to ever
    // find a home once handed off.
    where: { availability: true, OR: [{ id: { in: ids } }, { slug: { in: slugs } }] },
    select: { id: true, name: true, slug: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const rows: InventoryDraftRow[] = [];
  let dropped = 0;

  for (const raw of rawRows as IncomingRow[]) {
    if (!raw || typeof raw !== 'object') {
      dropped += 1;
      continue;
    }
    const product =
      (typeof raw.productId === 'string' ? byId.get(raw.productId) : undefined) ??
      (typeof raw.slug === 'string' ? bySlug.get(raw.slug) : undefined);
    if (!product) {
      dropped += 1;
      continue;
    }

    const declaredRaw = toFiniteNumber(raw.declaredKg ?? raw.declared);
    const priceRaw = toFiniteNumber(raw.pricePerKg);
    // A model can emit 0 to mean "not mentioned" — clamp out anything
    // negative or absurd, but a genuine 0 (an explicit "nothing today") is
    // left in; the admin decides what to keep on the review screen.
    const declared =
      declaredRaw !== undefined && declaredRaw >= 0 && declaredRaw <= MAX_KG ? declaredRaw : undefined;
    const pricePerKg =
      priceRaw !== undefined && priceRaw > 0 && priceRaw <= MAX_PRICE ? priceRaw : undefined;

    if (declared === undefined && pricePerKg === undefined) {
      dropped += 1;
      continue;
    }

    const confidenceRaw = toFiniteNumber(raw.confidence);
    const confidence =
      confidenceRaw !== undefined ? Math.min(1, Math.max(0, confidenceRaw)) : 0.5;

    rows.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      ...(declared !== undefined ? { declared } : {}),
      ...(pricePerKg !== undefined ? { pricePerKg } : {}),
      confidence,
      note: typeof raw.note === 'string' ? raw.note : '',
    });
  }

  if (!rows.length) {
    return NextResponse.json(
      { message: 'None of the rows matched a real, listed product with a usable number.' },
      { status: 422 }
    );
  }

  const response: InventoryDraftResponse & { dropped: number } = { day, rows, dropped };
  return NextResponse.json(response);
}

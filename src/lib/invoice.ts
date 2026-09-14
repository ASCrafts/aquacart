import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { SLOT_LABEL, formatDay, type Slot } from './business-day';

/**
 * The GST invoice for a paid order.
 *
 * Three things it has to get right that the rev 2 version could not:
 *
 * 1. **Kilos.** A line is `kg × pricePerKg = lineTotal`. There is no piece
 *    price and no quantity, so "2 × ₹250" becomes "1.500 kg @ Rs. 1,200.00/kg".
 * 2. **What actually arrived.** A short-fall means the line was charged for
 *    2 kg and delivered 1.5 kg. An invoice that prints only the ordered figure
 *    is a tax document that disagrees with the money, so `fulfilledKg` is shown
 *    whenever it differs and the refund is stated on the line and in the totals.
 * 3. **No email.** Phone is the contact of record; `customerEmail` is null for
 *    most customers and printing `undefined` under "Bill To" is how you find
 *    that out from a customer.
 */

/**
 * Rupees, spelled out rather than symbolised.
 *
 * PDFKit's built-in Helvetica is WinAnsi-encoded and has no glyph for U+20B9 —
 * a "₹" comes out blank or as a substitute character, which on a tax invoice is
 * worse than plain text. Embedding a TTF that has the glyph and setting this to
 * '₹' is the upgrade path; until there is a font file in the repo, this is
 * the honest rendering.
 */
const RUPEE = 'Rs. ';

/** "1,234.50" — Indian digit grouping, always two decimals. */
function amount(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function money(value: number): string {
  return RUPEE + amount(value);
}

/** Trailing zeros dropped: 1.5 kg, not 1.500 kg. Grams are the finest unit. */
function kilos(kg: number): string {
  return `${Number((Number.isFinite(kg) ? kg : 0).toFixed(3))} kg`;
}

/** GST on fresh seafood, already included in the displayed price. */
const GST_RATE = 0.05;

/**
 * Structural, not a Prisma import, so this module stays usable from a job, a
 * webhook or a test without dragging a generated type (and a database
 * connection) behind it. A Prisma `Order` with its `items` included satisfies
 * it as-is.
 */
export interface InvoiceOrderItem {
  name: string;
  kg: number;
  pricePerKg: number;
  lineTotal: number;
  /** What allocation actually gave this line. Equal to `kg` when nothing went wrong. */
  fulfilledKg?: number;
  refundedAmount?: number;
}

export interface InvoiceOrder {
  id: string;
  customerName: string;
  /** The contact of record. Always present. */
  customerPhone: string;
  /** Optional everywhere. */
  customerEmail?: string | null;
  /** JSON string — see Order.deliveryAddress in schema.prisma. */
  deliveryAddress: string;
  totalAmount: number;
  refundedAmount?: number;
  fulfilDay?: string;
  slot?: string;
  razorpayPaymentId?: string | null;
  createdAt: Date | string;
  items: InvoiceOrderItem[];
}

interface Address {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

/**
 * The address is stored as a JSON string, so it can be anything — including the
 * empty string, from an older row. An invoice that throws is an invoice that
 * never reaches the customer, so a malformed address degrades to blank lines.
 */
function parseAddress(raw: string): Address {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Address) : {};
  } catch {
    return {};
  }
}

export async function generateInvoice(order: InvoiceOrder): Promise<string> {
  const invoicesDir = path.join(process.cwd(), 'public', 'invoices');
  if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
  }

  const fileName = `invoice-${order.id}.pdf`;
  const filePath = path.join(invoicesDir, fileName);
  const publicUrl = `/invoices/${fileName}`;

  const address = parseAddress(order.deliveryAddress);
  const refunded = order.refundedAmount ?? 0;

  return new Promise<string>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ── Header ──
    doc.fillColor('#0050cb').fontSize(28).font('Helvetica-Bold').text('AquaCart', 50, 50);
    doc
      .fillColor('#666666')
      .fontSize(10)
      .font('Helvetica')
      .text('Tax Invoice / Receipt', 50, 85);

    doc
      .fillColor('#333333')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(`Invoice #: ${order.id.slice(-8).toUpperCase()}`, 350, 50, { align: 'right' })
      .font('Helvetica')
      .text(
        `Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}`,
        350,
        65,
        { align: 'right' }
      )
      .text(`Payment ID: ${order.razorpayPaymentId || 'N/A'}`, 350, 80, { align: 'right' });

    doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e0e0e0').stroke();

    // ── Bill To ── phone always, email only when there is one. The lines shift
    // up rather than leaving a gap, so a customer without an email does not get
    // an invoice with a hole in it.
    doc.fillColor('#333333').fontSize(11).font('Helvetica-Bold').text('Bill To:', 50, 125);
    doc.fontSize(10).font('Helvetica').text(order.customerName, 50, 142);
    let billY = 157;
    doc.text(order.customerPhone, 50, billY);
    if (order.customerEmail) {
      billY += 15;
      doc.text(order.customerEmail, 50, billY);
    }

    // ── Ship To ──
    doc.font('Helvetica-Bold').text('Ship To:', 300, 125);
    doc
      .font('Helvetica')
      .text(address.street ?? '', 300, 142)
      .text([address.city, address.state].filter(Boolean).join(', '), 300, 157)
      .text(address.zipCode ?? '', 300, 172);

    // When the order is fulfilled, in the customer's own words. Uses the same
    // slot vocabulary the confirmation and the push used, so three surfaces
    // cannot describe the same delivery three different ways.
    if (order.fulfilDay) {
      const label = SLOT_LABEL[order.slot as Slot] ?? '';
      doc
        .fillColor('#666666')
        .fontSize(9)
        .text(
          `Delivery: ${formatDay(order.fulfilDay)}${label ? `, ${label}` : ''}`,
          300,
          187
        )
        .fillColor('#333333');
    }

    // ── Table header ──
    const tableTop = 215;
    doc.fillColor('#f5f5f5').rect(50, tableTop - 5, 495, 22).fill();
    doc
      .fillColor('#333333')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('#', 55, tableTop, { width: 20 })
      .text('Item', 75, tableTop, { width: 200 })
      .text('Qty', 280, tableTop, { width: 60, align: 'right' })
      .text('Rate / kg', 350, tableTop, { width: 90, align: 'right' })
      .text('Amount', 450, tableTop, { width: 90, align: 'right' });

    // ── Rows ──
    let y = tableTop + 28;
    doc.font('Helvetica').fontSize(9);

    order.items.forEach((item, index) => {
      // A new page when the row would otherwise land in the footer. Without
      // this a ten-fish order silently prints its tail over the fine print.
      if (y > 660) {
        doc.addPage();
        y = 60;
      }

      const fulfilled = item.fulfilledKg ?? item.kg;
      const short = Math.abs(fulfilled - item.kg) > 1e-6;
      const lineRefund = item.refundedAmount ?? 0;

      doc
        .fillColor('#555555')
        .text(`${index + 1}`, 55, y, { width: 20 })
        .text(item.name, 75, y, { width: 200 })
        .text(kilos(item.kg), 280, y, { width: 60, align: 'right' })
        .text(money(item.pricePerKg), 350, y, { width: 90, align: 'right' })
        .text(money(item.lineTotal), 450, y, { width: 90, align: 'right' });

      y += 14;

      // The short-fall note. Printed under the line rather than replacing the
      // ordered figure, because the invoice has to show both what was charged
      // and what arrived for the refund below to make sense.
      if (short || lineRefund > 0) {
        const parts: string[] = [];
        if (short) parts.push(`delivered ${kilos(fulfilled)} of ${kilos(item.kg)}`);
        if (lineRefund > 0) parts.push(`${money(lineRefund)} refunded`);
        doc
          .fillColor('#a15c00')
          .fontSize(8)
          .text(parts.join(' · '), 75, y, { width: 380 })
          .fontSize(9);
        y += 12;
      }

      y += 6;
    });

    // ── Totals ──
    y += 10;
    doc.moveTo(350, y).lineTo(545, y).strokeColor('#e0e0e0').stroke();
    y += 10;

    // GST is inclusive in the displayed price, so the taxable value is backed
    // out of the total rather than added to it.
    const charged = order.totalAmount;
    const taxable = charged / (1 + GST_RATE);

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text('Taxable value:', 330, y, { width: 120, align: 'right' })
      .text(money(taxable), 450, y, { width: 90, align: 'right' });

    y += 18;
    doc
      .text('GST (5%, incl.):', 330, y, { width: 120, align: 'right' })
      .text(money(charged - taxable), 450, y, { width: 90, align: 'right' });

    y += 18;
    doc
      .text('Total charged:', 330, y, { width: 120, align: 'right' })
      .text(money(charged), 450, y, { width: 90, align: 'right' });

    if (refunded > 0) {
      y += 18;
      doc
        .fillColor('#a15c00')
        .text('Refunded:', 330, y, { width: 120, align: 'right' })
        .text(`- ${money(refunded)}`, 450, y, { width: 90, align: 'right' })
        .fillColor('#555555');
    }

    y += 18;
    doc.moveTo(350, y).lineTo(545, y).strokeColor('#e0e0e0').stroke();

    y += 8;
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#0050cb')
      // "Net paid", not "Grand total": once a short-fall has been refunded, the
      // total charged and the amount the customer is actually out are different
      // numbers, and the one they care about is this one.
      .text(refunded > 0 ? 'Net paid:' : 'Grand total:', 330, y, {
        width: 120,
        align: 'right',
      })
      .text(money(Math.max(0, charged - refunded)), 450, y, { width: 90, align: 'right' });

    // ── Footer ──
    doc
      .fillColor('#999999')
      .fontSize(8)
      .font('Helvetica')
      .text('Thank you for shopping with AquaCart!', 50, 720, { align: 'center' })
      .text(
        'This is a computer-generated invoice and does not require a signature.',
        50,
        732,
        { align: 'center' }
      );

    doc.end();

    stream.on('finish', () => resolve(publicUrl));
    stream.on('error', reject);
  });
}

import { z } from 'zod';

/**
 * What the multimodal model can decide about ONE fish from a photo/voice note.
 *
 * Rev 3 kills piece-based stock, and with it the old ADD_STOCK/REMOVE_STOCK
 * split — there is nothing to add or remove, only what is on ice *today*
 * (see declareStock() in src/lib/stock.ts: "declare, don't increment"). So a
 * row either states today's landed kilos, states a price-only correction, or
 * is UNKNOWN because the input didn't match a real product.
 *
 * Nothing derived from this schema is ever written to the database by the
 * extraction route. It only produces a proposal; the admin reviews it in
 * MultimodalInventoryAgent, and the reviewed rows are handed to the stock
 * sheet as a draft (see InventoryDraftRow below).
 */
export const InventoryIntentSchema = z.enum(['DECLARE_STOCK', 'UPDATE_PRICE', 'UNKNOWN']);
export type InventoryIntent = z.infer<typeof InventoryIntentSchema>;

// Every field carries a `.default()`. The model is INSTRUCTED to always emit
// them, but this schema also has to survive a model that skips a field on an
// UNKNOWN row — falling back to a safe default beats a 500 from a strict
// parse on what is, after all, an unreliable multimodal extraction.
export const InventoryRowSchema = z.object({
  intent: InventoryIntentSchema.default('UNKNOWN'),
  /** Existing product id, filled in by the lookupProduct tool. Empty if unmatched. */
  productId: z
    .string()
    .default('')
    .describe(
      "The 'id' field returned by the lookupProduct tool for the matched product. Empty string if no match was found."
    ),
  /** Existing product slug, for display and as a fallback match key. */
  slug: z.string().default('').describe("Matched product slug, e.g. 'seer-fish'. Empty string if unmatched."),
  /** Display only — never used to create a product. Rev 3 forbids new-product insertion here. */
  name: z.string().default('').describe('Product name as best understood from the input.'),
  /** Kilograms landed/on ice today. Absolute, never a delta. 0 = not mentioned. */
  declaredKg: z
    .number()
    .min(0)
    .default(0)
    .describe('Kilograms that landed today, as an absolute figure. 0 if not mentioned.'),
  /** Rupees per kilogram for today's catch. 0 = not mentioned, keep the existing price. */
  pricePerKg: z.number().min(0).default(0).describe("Rupees per kilogram for today's catch. 0 if not specified."),
  /** 0-1: how sure the model is that the product match AND the numbers are right. */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe(
      'Confidence 0-1 that the product match and the extracted numbers are correct. Lower it for illegible handwriting, ambiguous Tanglish, or a guessed match.'
    ),
  /** One line the admin can read to decide whether to trust the row. */
  note: z
    .string()
    .default('')
    .describe(
      'One-line reasoning: how the product was matched, any voice/vision conflict resolved, any translation applied.'
    ),
});
export type InventoryRow = z.infer<typeof InventoryRowSchema>;

export const InventoryAnalysisSchema = z.object({
  rows: z
    .array(InventoryRowSchema)
    .default([])
    .describe('One entry per fish mentioned or shown, in the order encountered.'),
  /** Verbatim transcription of any voice input, or empty string. */
  transcription: z.string().default(''),
  /** Overall summary — ambiguity, assumptions, anything the admin should double-check. */
  aiSummary: z.string().default(''),
});
export type InventoryAnalysis = z.infer<typeof InventoryAnalysisSchema>;

/**
 * One row of the draft handed back by /api/admin/inventory-agent/sync, and
 * the exact shape written to sessionStorage under
 * `aquacart:stock-draft:<businessDay>` for StockSheet.tsx to merge in as
 * edits (see readAgentDraft() in src/components/admin/StockSheet.tsx, which
 * accepts either `productId` or `slug` plus `declared`/`planned`/`pricePerKg`).
 *
 * `declared` and `pricePerKg` are OMITTED, not zeroed, when the model found
 * nothing to say about that field — StockSheet treats a missing field as
 * "leave this number alone", and a stray 0 would read as "no catch today".
 */
export interface InventoryDraftRow {
  productId: string;
  slug: string;
  name: string;
  declared?: number;
  pricePerKg?: number;
  confidence: number;
  note: string;
}

export interface InventoryDraftResponse {
  day: string;
  rows: InventoryDraftRow[];
}

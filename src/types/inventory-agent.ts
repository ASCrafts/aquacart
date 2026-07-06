import { z } from 'zod';

export const InventoryIntentSchema = z.enum(['ADD_STOCK', 'UPDATE_PRICE', 'REMOVE_STOCK', 'UNKNOWN']);

export const InventoryAnalysisSchema = z.object({
  intent: InventoryIntentSchema,
  sku: z.string().describe("Extracted or matching product SKU/slug. Example: 'fresh-salmon'."),
  name: z.string().describe("Product name extracted from image or voice command."),
  quantity: z.number().describe("Quantity specified. Positive for ADD_STOCK, negative or positive deduction for REMOVE_STOCK, 0 for other intents."),
  stockKg: z.number().describe("Stock in kilograms specified. Positive for ADD_STOCK, negative or positive deduction for REMOVE_STOCK, 0 for other intents."),
  price: z.number().describe("Price of the product. If updated or specified, set the price. If price is not specified, return 0."),
  aiSummary: z.string().describe("Detailed reasoning of decisions made, conflict resolutions, and tool usage explanations."),
  transcription: z.string().describe("Transcription of the recorded voice command, or empty string if not provided."),
});

export type InventoryIntent = z.infer<typeof InventoryIntentSchema>;
export type InventoryAnalysis = z.infer<typeof InventoryAnalysisSchema>;

export interface SyncResponse {
  success: boolean;
  message: string;
  product?: {
    id: string;
    name: string;
    slug: string;
    price: number;
    quantity: number;
    stockKg: number;
    category: string;
  };
}

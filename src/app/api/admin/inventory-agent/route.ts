import { NextRequest, NextResponse } from 'next/server';
import { generateText, tool, isStepCount } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { businessDay } from '@/lib/business-day';
import { InventoryAnalysisSchema } from '@/types/inventory-agent';

/**
 * Multimodal extraction — image and/or voice in, a PROPOSAL out. This route
 * never touches the database beyond read-only lookups; nothing here declares
 * stock. See /api/admin/inventory-agent/sync for why writing is a separate,
 * later, human-reviewed step.
 */

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `
You are a highly efficient and accurate Multimodal AI Inventory Assistant for the AquaCart e-commerce store.
Your goal is to extract, for EACH fish mentioned or shown, what landed today and/or its price, and identify which
existing product it matches. Output a structured JSON response.

### Kilograms only.
AquaCart tracks stock in kilograms and nothing else — there are no "pieces" any more. Every row you produce
has ONLY "declaredKg" (kilograms that physically landed today, as an ABSOLUTE figure — never a delta, never
"add N") and "pricePerKg" (rupees per kilogram for today's catch). If the input mentions a piece count, use it
only to help you estimate the total kilograms (e.g. avgPieceWeight from a lookupProduct result), never as an
output field.

### Modality Conflict Resolution Rules:
1. VOICE PRECEDENCE: If there is any conflict between what is visible in the image (e.g. an invoice list,
   weighing-scale readout, or price tag) and what the user says in the audio command (e.g. "make that 12 kg
   instead", "the actual price today is 450"), the VOICE command always takes precedence.
2. COMPLEMENTARY DATA: Merge visual details (what's on the scale, printed weights, price boards) with verbal
   specifications (corrections, price settings, which fish is being counted).

### Tanglish & Tamil Translation Rules:
The user might speak or write in Tanglish (Tamil words written in English script) or Tamil. If the user mentions
a fish name in Tamil or Tanglish, you MUST map it to its English counterpart to query the database.
Here is the translation mapping you MUST use:
- Soora / Soora Meen / சூரை / சூரை மீன் -> Tuna Fish (Note: Distinguish from Sora/Shark)
- Sora / Shark / சுறா -> Shark
- Vanjiram / Seerfish / வஞ்சிரம் -> Seer Fish
- Sankara / Red Snapper / சங்கரா -> Red Snapper
- Nethili / Anchovy / Whitebait / நெத்திலி -> Anchovy
- Mathi / Chala / Sardine / மத்தி -> Sardine
- Kanangeluthi / Mackerel / கானாங்கெளுத்தி -> Mackerel
- Viral / Murrel / Snakehead / விரால் -> Murrel
- Katla / Catla / கட்லா -> Catla
- Rohu / ரோகு -> Rohu
- Sheela / Barracuda / சீலா -> Barracuda
- Vavval / Pomfret / வவ்வால் -> Pomfret
- Paara / Trevally / பாறை -> Trevally
- Eraal / Prawn / Shrimp / இறால் -> Prawn
- Nandu / Crab / நண்டு -> Crab
- Kanava / Squid / Cuttlefish / கணவா -> Squid

Use the English counterpart from this mapping to query the database using the \`lookupProduct\` tool.

### Tool Usage & Idempotence Instructions:
1. DATABASE LOOKUP: For EVERY fish you detect, call \`lookupProduct\` to find the matching existing product
   (query by name, category, or slug). It also returns today's already-declared kilos and price, if any — use
   that as context, not as something to add to.
2. NO NEW PRODUCTS: You must ONLY match existing fish already in the inventory. If \`lookupProduct\` finds no
   good match, set that row's "intent" to "UNKNOWN", leave "productId"/"slug" empty, and explain why in "note".
   Never invent a productId.
3. ONE ROW PER FISH: If several fish are mentioned or shown (an invoice with a list, several voice instructions),
   emit one row per fish, in the order you encountered them.
4. CONFIDENCE: Set "confidence" (0-1) honestly per row — lower it for illegible handwriting, an ambiguous
   Tanglish name, a guessed product match, or a number you are inferring rather than reading directly.

### Output Guidelines:
Your final output MUST be a single, valid JSON object matching the requested schema. Do NOT wrap the JSON in
markdown code blocks. Return ONLY the raw JSON string.

The JSON schema you must adhere to is:
{
  "rows": [
    {
      "intent": "DECLARE_STOCK" | "UPDATE_PRICE" | "UNKNOWN",
      "productId": "id from lookupProduct, or empty string if unmatched",
      "slug": "matched slug, or empty string",
      "name": "product name as understood",
      "declaredKg": 12.5,   // absolute kilograms landed today. 0 if not mentioned.
      "pricePerKg": 450,    // rupees per kg today. 0 if not specified.
      "confidence": 0.9,    // 0-1
      "note": "one line: how matched, any conflict resolved, any translation applied"
    }
  ],
  "transcription": "verbatim or polished transcription of what was said, or empty string",
  "aiSummary": "overall summary of what was extracted and any ambiguity"
}
`;

interface LookupMatch {
  id: string;
  name: string;
  slug: string;
  category: string;
  basePricePerKg: number;
  todayDeclaredKg: number | null;
  todayPricePerKg: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || session.user?.role !== ROLES.ADMIN) {
      return NextResponse.json({ message: 'Unauthorized. Admins only.' }, { status: 401 });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const audioFile = formData.get('audio') as File | null;

    if (!imageFile && !audioFile) {
      return NextResponse.json(
        { message: 'Please provide at least an image or an audio recording.' },
        { status: 400 }
      );
    }

    const today = businessDay();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vercel AI SDK content parts are a discriminated union not worth re-typing here.
    const contentParts: any[] = [
      {
        type: 'text',
        text: 'Analyze this multimodal input. Use lookupProduct to match every fish against the existing catalog. Return ONLY a raw JSON string matching the instructions. If audio is provided, transcribe it verbatim into the "transcription" field.',
      },
    ];

    if (imageFile) {
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      contentParts.push({
        type: 'image',
        image: imageBuffer,
        mediaType: imageFile.type || 'image/jpeg',
      });
    }

    if (audioFile) {
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
      contentParts.push({
        type: 'file',
        data: audioBuffer,
        mediaType: audioFile.type || 'audio/webm',
      });
    }

    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentParts }],
      tools: {
        lookupProduct: tool({
          description:
            "Search the catalog for an existing product by name/slug/category. Returns candidates with today's already-declared kilos and price so you don't propose re-stating them as a delta.",
          inputSchema: z.object({
            query: z.string().describe('The name, slug, or category to search for'),
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool() infers this from inputSchema; the return shape is intentionally loose JSON handed to the model.
          execute: async ({ query }: { query: string }): Promise<any> => {
            try {
              const products = await prisma.product.findMany({
                where: {
                  availability: true,
                  OR: [
                    { name: { contains: query } },
                    { slug: { contains: query } },
                    { aliases: { contains: query } },
                    { category: { contains: query } },
                  ],
                },
                take: 5,
                select: { id: true, name: true, slug: true, category: true, basePricePerKg: true },
              });

              if (!products.length) {
                return { found: false, message: 'No matching product found in the catalog.' };
              }

              const todayRows = await prisma.dayStock.findMany({
                where: { day: today, productId: { in: products.map((p) => p.id) } },
                select: { productId: true, declared: true, pricePerKg: true, declaredAt: true },
              });
              const byProduct = new Map(todayRows.map((r) => [r.productId, r]));

              const matches: LookupMatch[] = products.map((p) => {
                const row = byProduct.get(p.id);
                return {
                  id: p.id,
                  name: p.name,
                  slug: p.slug,
                  category: p.category,
                  basePricePerKg: p.basePricePerKg,
                  todayDeclaredKg: row?.declaredAt ? row.declared : null,
                  todayPricePerKg: row?.pricePerKg ?? null,
                };
              });

              return { found: true, matches };
            } catch (err) {
              console.error('Error executing lookupProduct tool:', err);
              return { found: false, error: 'Database search failed.' };
            }
          },
        }),
      },
      stopWhen: isStepCount(6),
    });

    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsedJson: unknown = JSON.parse(cleanedText);
    const validatedData = InventoryAnalysisSchema.parse(parsedJson);

    return NextResponse.json(validatedData);
  } catch (error) {
    console.error('Error in Multimodal Inventory Route:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ message: 'Failed to process inventory input.', error: message }, { status: 500 });
  }
}

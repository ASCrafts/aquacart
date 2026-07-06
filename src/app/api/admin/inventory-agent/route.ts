import { NextRequest, NextResponse } from 'next/server';
import { generateText, tool, isStepCount } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { InventoryAnalysisSchema } from '@/types/inventory-agent';

// Ensure this route is dynamic
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `
You are a highly efficient and accurate Multimodal AI Inventory Assistant for the AquaCart e-commerce store.
Your goal is to extract product details, identify user intent, and output a structured JSON response.

### Modality Conflict Resolution Rules:
1. VOICE PRECEDENCE: If there is any conflict between what is visible in the image (e.g. an invoice list, price tag, or physical product quantity) and what the user says in the audio command (e.g. "change that price to 10.99 instead", "add 15 more", "the actual received amount is 10"), the VOICE command always takes precedence.
2. COMPLEMENTARY DATA: Merge visual details (product appearance, category, logo, printed text) with verbal specifications (specific quantity overrides, category changes, price settings).

### Tanglish & Tamil Translation Rules:
The user might speak or write in Tanglish (Tamil words written in English script) or Tamil. If the user mentions a fish name in Tamil or Tanglish, you MUST map it to its English counterpart to query the database.
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

Use the English counterpart from this mapping to query the database using the \`lookupProduct\` tool. If the lookup returns multiple matches (e.g. for "Tuna Fish" vs "Bluefin Tuna Steak"), select the one that matches the user's intent most closely (defaulting to "Tuna Fish" if they just say "Soora Meen" or "Tuna").

### Tool Usage & Idempotence Instructions:
1. DATABASE LOOKUP: You MUST use the \`lookupProduct\` tool if the user refers to a product that might already exist in the database, wants to update a price, or mentions adding stock to an existing item. Query by name, category, or slug first to check if a record exists.
2. NO NEW INSERTION OF FISH: You must ONLY update existing fish products in the inventory. If the product is not found in the database via the \`lookupProduct\` tool (or does not exist), do NOT attempt to create a new product. Instead, set 'intent' to 'UNKNOWN' and state in 'aiSummary' that the product does not exist in the inventory.
3. IDEMPOTENT RESOLUTION: If the product exists, copy its exact slug/SKU into the 'sku' field. Note down the current price and stock levels returned by the tool and explain in the 'aiSummary' how your action relates to them (e.g., "Matched existing product with slug 'red-snapper'. Current stock: 5 pieces, 2.5 kg. Adding 10 pieces and 5.0 kg as requested by voice command.").

### Quantity and Weight (Kg) Rules:
The user can specify BOTH pieces (quantity) and weight in kilograms (stockKg). For example, "add 10 pieces and 5 kg".
- Extract the pieces amount into the "quantity" field.
- Extract the weight in kilograms into the "stockKg" field.
- If only one of them is specified, set the other to 0.

### Output Guidelines:
Your final output MUST be a single, valid JSON object matching the requested schema.
Do NOT wrap the JSON in markdown code blocks (e.g., do NOT use \`\`\`json ... \`\`\`). Return ONLY the raw JSON string.

The JSON schema you must adhere to is:
{
  "intent": "ADD_STOCK" | "UPDATE_PRICE" | "REMOVE_STOCK" | "UNKNOWN",
  "sku": "unique-product-slug-or-sku",
  "name": "Product Name",
  "quantity": 10.0, // Number representing pieces to add, subtract, or set. Use 0 if not changing pieces.
  "stockKg": 5.5,  // Number representing weight in kg to add, subtract, or set. Use 0 if not changing weight.
  "price": 12.99,    // Product price. Use 0 if price is unchanged or not specified.
  "aiSummary": "Summary of reasoning, tools used, translation mappings applied, and modality conflict resolutions.",
  "transcription": "Verbatim or polished transcription of what was said in the audio."
}
`;

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session || session.user?.role !== ROLES.ADMIN) {
      return NextResponse.json({ message: 'Unauthorized. Admins only.' }, { status: 401 });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const audioFile = formData.get('audio') as File | null;

    if (!imageFile && !audioFile) {
      return NextResponse.json({ message: 'Please provide at least an image or an audio recording.' }, { status: 400 });
    }

    // Build content parts for the Vercel AI SDK multimodal input
    const contentParts: any[] = [
      {
        type: 'text',
        text: 'Analyze this multimodal input. Use the tools to lookup existing products. Return ONLY a raw JSON string matching the instructions. If audio is provided, listen to it carefully, execute the appropriate inventory command, and transcribe the audio verbatim into the "transcription" field.'
      }
    ];

    if (imageFile) {
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      contentParts.push({
        type: 'image',
        image: imageBuffer,
        mediaType: imageFile.type || 'image/jpeg'
      });
    }

    if (audioFile) {
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
      contentParts.push({
        type: 'file',
        data: audioBuffer,
        mediaType: audioFile.type || 'audio/webm'
      });
    }

    // Call Gemini 2.5 Flash via Vercel AI SDK with tools
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: contentParts
        }
      ],
      tools: {
        lookupProduct: tool({
          description: 'Search the database for an existing product by name or slug to fetch its current price and stock levels.',
          inputSchema: z.object({
            query: z.string().describe('The name or slug query to search for')
          }),
          execute: async ({ query }: { query: string }): Promise<any> => {
            try {
              const p = await prisma.product.findFirst({
                where: {
                  OR: [
                    { name: { contains: query } },
                    { slug: { contains: query } }
                  ]
                }
              });

              if (!p) return { found: false, message: 'No matching product found in database.' };

              return {
                found: true,
                id: p.id,
                name: p.name,
                slug: p.slug,
                price: p.price,
                quantity: p.quantity,
                category: p.category
              };
            } catch (err) {
              console.error('Error executing lookupProduct tool:', err);
              return { found: false, error: 'Database search failed.' };
            }
          }
        })
      },
      stopWhen: isStepCount(5) // Allow tool use and final answer generation up to 5 steps
    });

    // Clean JSON response (remove any accidental markdown code block wrappers)
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsedJson = JSON.parse(cleanedText);
    const validatedData = InventoryAnalysisSchema.parse(parsedJson);

    return NextResponse.json(validatedData);
  } catch (error: any) {
    console.error('Error in Multimodal Inventory Route:', error);
    return NextResponse.json(
      {
        message: 'Failed to process inventory input.',
        error: error.message || String(error)
      },
      { status: 500 }
    );
  }
}

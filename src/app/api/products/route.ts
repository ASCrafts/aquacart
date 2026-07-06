import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ProductModel from '@/models/Product';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    await dbConnect();
    const allProducts = await ProductModel.find({});
    
    // Filter out invalid IDs (like we did before)
    const validProducts = allProducts.filter((product) =>
      product._id && typeof product._id === 'string' && product._id.length >= 8
    );

    return NextResponse.json(validProducts, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

import { writeFile } from 'fs/promises';
import path from 'path';

// NEW: POST method to create a product with file upload
export async function POST(request: Request) {
  try {
    // 1. Security Check
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    // 2. Parse FormData
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const slug = (formData.get('slug') as string)?.toLowerCase().trim();
    const description = formData.get('description') as string;
    const price = parseFloat(formData.get('price') as string);
    const category = formData.get('category') as string;
    const quantity = parseInt(formData.get('quantity') as string, 10);
    const stockKg = parseFloat(formData.get('stockKg') as string);
    const pricePerKg = parseFloat(formData.get('pricePerKg') as string) || 0;
    const maxQuantity = parseInt(formData.get('maxQuantity') as string, 10) || 99;

    // Validate slug
    if (!slug) {
      return NextResponse.json({ message: 'Slug is required' }, { status: 400 });
    }
    const existingProduct = await ProductModel.findOne({ slug });
    if (existingProduct) {
      return NextResponse.json({ message: `A product with the slug "${slug}" already exists. Please use a different slug.` }, { status: 409 });
    }
    
    const file = formData.get('image') as File | null;
    let imageUrl = '';
    
    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
      await writeFile(filepath, buffer);
      imageUrl = `/uploads/${filename}`;
    } else {
      return NextResponse.json({ message: 'Image file is required' }, { status: 400 });
    }

    // 3. Create Product
    const newProduct = await ProductModel.create({
      name, slug, description, price, pricePerKg, category, quantity, stockKg, maxQuantity, imageUrl
    });

    return NextResponse.json(newProduct, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create product:', error);
    return NextResponse.json(
      { message: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ProductModel from '@/models/Product';
function isValidId(id: string) {
  return typeof id === 'string' && id.length >= 8;
}
import { auth } from '@/lib/auth';

// Define the type for the route params
type Props = {
  params: Promise<{ id: string }>;
};

// GET: Fetch a single product
export async function GET(request: Request, { params }: Props) {
  try {
    await dbConnect();
    // FIX: Await the params object before accessing id
    const { id } = await params;

    if (!isValidId(id)) {
      return NextResponse.json(
        { message: 'Invalid product ID' },
        { status: 400 }
      );
    }

    const product = await ProductModel.findById(id);

    if (!product) {
      return NextResponse.json(
        { message: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(product, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch product:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

import { writeFile } from 'fs/promises';
import path from 'path';

// PUT: Update an existing product
export async function PUT(request: Request, { params }: Props) {
  try {
    // 1. Check Authentication
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    // FIX: Await the params object
    const { id } = await params;

    if (!isValidId(id)) {
      return NextResponse.json(
        { message: 'Invalid product ID' },
        { status: 400 }
      );
    }

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
    
    // Construct the payload dynamically
    const updatePayload: any = {
      name, description, price, pricePerKg, category, quantity, stockKg, maxQuantity
    };

    // Handle slug update with uniqueness check
    if (slug) {
      const existingProduct = await ProductModel.findOne({ slug, _id: { $ne: id } });
      if (existingProduct) {
        return NextResponse.json({ message: `A product with the slug "${slug}" already exists.` }, { status: 409 });
      }
      updatePayload.slug = slug;
    }

    const file = formData.get('image') as File | null;
    
    // Only upload a new file and overwrite imageUrl if a new File was provided
    if (file && file.size > 0 && file.name) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
      await writeFile(filepath, buffer);
      updatePayload.imageUrl = `/uploads/${filename}`;
    }

    const updatedProduct = await ProductModel.findByIdAndUpdate(id, updatePayload, {
      new: true, // Return the updated document
      runValidators: true, // Ensure updates follow the schema
    });

    if (!updatedProduct) {
      return NextResponse.json(
        { message: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedProduct, { status: 200 });
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a product
export async function DELETE(request: Request, { params }: Props) {
  try {
    // 1. Check Authentication
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    // FIX: Await the params object
    const { id } = await params;

    if (!isValidId(id)) {
      return NextResponse.json(
        { message: 'Invalid product ID' },
        { status: 400 }
      );
    }

    const deletedProduct = await ProductModel.findByIdAndDelete(id);

    if (!deletedProduct) {
      return NextResponse.json(
        { message: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Product deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to delete product:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// PATCH: Toggle product availability (stock toggle)
export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await auth();
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const { id } = await params;

    if (!isValidId(id)) {
      return NextResponse.json({ message: 'Invalid product ID' }, { status: 400 });
    }

    const body = await request.json();
    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      { availability: body.availability },
      { new: true }
    );

    if (!updatedProduct) {
      return NextResponse.json({ message: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(updatedProduct, { status: 200 });
  } catch (error) {
    console.error('Failed to toggle availability:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
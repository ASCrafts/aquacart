
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';
import ProductModel from '@/models/Product';
import { ObjectIdWrapper } from '@/models/helpers';

// GET cart
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    await dbConnect();
    const user = await UserModel.findById(session.user.id).populate('cart.items.productId', 'name price imageUrl');
    if (!user) {
      // Session references a deleted user — treat as logged out
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(user.cart, { status: 200 });
  } catch (error: any) {
    console.error('GET cart error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}


// POST to add/update item in cart
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { productId, quantity } = await request.json();
    if (!productId || !quantity || quantity < 1) {
      return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
    }

    await dbConnect();
    const user = await UserModel.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    
    const product = await ProductModel.findById(productId);
    if(!product || !product.availability || product.quantity < quantity) {
        return NextResponse.json({ message: 'Product not available in desired quantity' }, { status: 400 });
    }

    const cartItemIndex = user.cart.items.findIndex(item => item.productId.toString() === productId);

    if (cartItemIndex > -1) {
      // Update quantity
      user.cart.items[cartItemIndex].quantity += quantity;
    } else {
      // Add new item
      user.cart.items.push({ productId: new ObjectIdWrapper(productId) as any, quantity, unit: 'piece' });
    }

    await user.save();
    return NextResponse.json(user.cart, { status: 200 });

  } catch (error: any) {
    console.error('POST cart error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT to update item quantity
export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  
    try {
      const { productId, quantity } = await request.json();
      if (!productId || quantity === undefined || quantity < 0) {
        return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
      }
  
      await dbConnect();
      const user = await UserModel.findById(session.user.id);
      if (!user) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
  
      const cartItemIndex = user.cart.items.findIndex(item => item.productId.toString() === productId);
  
      if (cartItemIndex > -1) {
        if (quantity === 0) {
          // Remove item
          user.cart.items.splice(cartItemIndex, 1);
        } else {
          // Update quantity
          const product = await ProductModel.findById(productId);
          if(!product || !product.availability || product.quantity < quantity) {
              return NextResponse.json({ message: 'Product not available in desired quantity' }, { status: 400 });
          }
          user.cart.items[cartItemIndex].quantity = quantity;
        }
        await user.save();
        return NextResponse.json(user.cart, { status: 200 });
      } else {
        return NextResponse.json({ message: 'Item not in cart' }, { status: 404 });
      }
    } catch (error: any) {
      console.error('PUT cart error:', error);
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE to remove an item from cart
export async function DELETE(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
  
    try {
      const { productId } = await request.json();
      if (!productId) {
        return NextResponse.json({ message: 'Product ID is required' }, { status: 400 });
      }
  
      await dbConnect();
      const user = await UserModel.findById(session.user.id);
      if (!user) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      user.cart.items = user.cart.items.filter(item => item.productId.toString() !== productId);
  
      await user.save();
      return NextResponse.json(user.cart, { status: 200 });
    } catch (error: any) {
      console.error('DELETE cart error:', error);
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

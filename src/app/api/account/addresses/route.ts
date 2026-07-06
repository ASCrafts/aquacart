import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';
import { ObjectIdWrapper } from '@/models/helpers';

// POST a new address
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    await dbConnect();
    const user = await UserModel.findById(session.user.id);
    if (!user) return NextResponse.json({ message: 'User not found' }, { status: 404 });

    // If it's the first address, make it default
    const isFirstAddress = user.addresses.length === 0;
    
    user.addresses.push({ ...body, isDefault: isFirstAddress });
    await user.save();

    return NextResponse.json(user.addresses, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT to update (delete or set default)
export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

    try {
        const { addressId, action } = await request.json();
        await dbConnect();
        const user = await UserModel.findById(session.user.id);
        if (!user) return NextResponse.json({ message: 'User not found' }, { status: 404 });

        const addressObjectId = new ObjectIdWrapper(addressId);

        if (action === 'delete') {
            user.addresses = user.addresses.filter(addr => addr._id.toString() !== addressId);
            // If the deleted address was the default, make the first one default
            const defaultExists = user.addresses.some(a => a.isDefault);
            if (!defaultExists && user.addresses.length > 0) {
                user.addresses[0].isDefault = true;
            }
        } else if (action === 'setDefault') {
            user.addresses.forEach(addr => {
                addr.isDefault = addr._id.equals(addressObjectId);
            });
        } else {
            return NextResponse.json({ message: 'Invalid action' }, { status: 400 });
        }

        await user.save();
        return NextResponse.json(user.addresses, { status: 200 });

    } catch (error) {
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

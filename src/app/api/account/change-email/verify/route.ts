import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { otp } = await req.json();
    if (!otp || typeof otp !== 'string' || otp.length !== 6) {
      return NextResponse.json({ message: 'Verification code must be 6 digits.' }, { status: 400 });
    }

    await dbConnect();

    const user = await UserModel.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ message: 'User not found.' }, { status: 404 });
    }

    if (!user.tempEmail) {
      return NextResponse.json({ message: 'No email change request found.' }, { status: 400 });
    }

    if (user.tempEmailVerificationToken !== otp) {
      return NextResponse.json({ message: 'Invalid verification code.' }, { status: 400 });
    }

    if (!user.tempEmailVerificationTokenExpiry || user.tempEmailVerificationTokenExpiry < new Date()) {
      return NextResponse.json({ message: 'Verification code has expired.' }, { status: 400 });
    }

    // Re-verify that the email wasn't taken while waiting for verification
    const emailInUse = await UserModel.findOne({ email: user.tempEmail });
    if (emailInUse && (emailInUse as any)._id.toString() !== (user as any)._id.toString()) {
      return NextResponse.json({ message: 'New email address is already in use.' }, { status: 400 });
    }

    // Update email
    user.email = user.tempEmail;
    user.isEmailVerified = true; // Mark as verified since they verified it just now
    user.tempEmail = undefined;
    user.tempEmailVerificationToken = undefined;
    user.tempEmailVerificationTokenExpiry = undefined;

    await user.save();

    return NextResponse.json({ message: 'Email updated successfully. Please log in again.' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

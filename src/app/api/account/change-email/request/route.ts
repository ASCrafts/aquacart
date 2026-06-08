import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import UserModel from '@/models/User';
import { sendVerificationEmail } from '@/lib/email';
import { ALLOWED_EMAIL_DOMAINS } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { newEmail } = await req.json();
    if (!newEmail || typeof newEmail !== 'string') {
      return NextResponse.json({ message: 'New email is required.' }, { status: 400 });
    }

    const trimmedEmail = newEmail.trim().toLowerCase();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json({ message: 'Invalid email address format.' }, { status: 400 });
    }

    // Check allowed domains
    const domain = trimmedEmail.split('@')[1];
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      return NextResponse.json(
        { message: 'Please use a Gmail, Yahoo, Outlook, or iCloud email.' },
        { status: 400 }
      );
    }

    await dbConnect();

    // Check if another user already verified this email
    const emailInUse = await UserModel.findOne({ email: trimmedEmail });
    if (emailInUse) {
      return NextResponse.json({ message: 'Email address is already in use.' }, { status: 400 });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    const user = await UserModel.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ message: 'User not found.' }, { status: 404 });
    }

    user.tempEmail = trimmedEmail;
    user.tempEmailVerificationToken = otp;
    user.tempEmailVerificationTokenExpiry = otpExpiry;

    await user.save();
    await sendVerificationEmail(trimmedEmail, otp);

    return NextResponse.json({ message: 'Verification code sent to your new email.' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

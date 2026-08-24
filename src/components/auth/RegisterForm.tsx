'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ALLOWED_EMAIL_DOMAINS } from '@/lib/constants';
import { Waves, CheckCircle, AlertCircle, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

const registerFormSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  email: z.string().email().refine(
    (email) => {
      const domain = email.split('@')[1];
      return ALLOWED_EMAIL_DOMAINS.includes(domain);
    },
    { message: 'Please use a Gmail, Yahoo, Outlook, or iCloud email.' }
  ),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/, {
    message: 'Enter a valid international phone number (e.g., +15551234).',
  }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
  otp: z.string().optional(),
});

export function RegisterForm() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccess, setApiSuccess] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasSentOtp, setHasSentOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<z.infer<typeof registerFormSchema>>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { name: '', email: '', phone: '', password: '', otp: '' },
  });

  const handleSendOtp = async () => {
    setApiError(null);
    setApiSuccess(null);
    const detailsValid = await form.trigger(['name', 'email', 'phone', 'password']);
    if (!detailsValid) {
      setApiError('Please fill in your details correctly before sending the code.');
      return;
    }
    setIsSendingOtp(true);
    const { name, email, phone, password } = form.getValues();
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password }),
      });
      const data = await response.json();
      if (response.ok) {
        setApiSuccess(data.message);
        setHasSentOtp(true);
      } else {
        setApiError(data.message || 'An error occurred.');
      }
    } catch {
      setApiError('Failed to connect to the server.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    setApiError(null);
    setApiSuccess(null);
    const otp = form.getValues('otp');
    if (!otp || otp.length !== 6) {
      setApiError('Please enter the 6-digit OTP.');
      return;
    }
    setIsVerifyingOtp(true);
    const { email } = form.getValues();
    try {
      const response = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await response.json();
      if (response.ok) {
        setApiSuccess(data.message);
        setIsEmailVerified(true);
      } else {
        setApiError(data.message || 'An error occurred during OTP verification.');
      }
    } catch {
      setApiError('Failed to verify OTP.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  async function onRegisterSubmit() {
    setIsRegistering(true);
    router.push('/login?verified=true');
  }

  const getFieldError = (field: keyof z.infer<typeof registerFormSchema>) => {
    return form.formState.errors[field]?.message;
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-aq-surface p-4" id="register-page">
      <div className="w-full max-w-md">
        <div className="aq-card-static p-8 md:p-10 animate-fade-in-up">
          {/* Logo & Header */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-aq-gradient-primary flex items-center justify-center shadow-aq-sm">
              <Waves className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">Create Account</h1>
              <p className="text-sm text-aq-on-surface-variant mt-1">Join AquaCart for the freshest seafood</p>
            </div>
          </div>

          {/* Alerts */}
          {apiSuccess && (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800 mb-5 animate-scale-in">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <span>{apiSuccess}</span>
            </div>
          )}
          {apiError && (
            <div className="flex items-center gap-2.5 rounded-xl bg-aq-error-container p-3.5 text-sm text-aq-error mb-5 animate-scale-in">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onRegisterSubmit)}>
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-name">Full Name</label>
              <input
                id="reg-name"
                className="aq-input h-12 px-4 text-sm"
                placeholder="John Doe"
                type="text"
                disabled={isEmailVerified}
                {...form.register('name')}
              />
              {getFieldError('name') && <span className="text-xs text-aq-error">{getFieldError('name')}</span>}
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-email">Email</label>
              <input
                id="reg-email"
                className="aq-input h-12 px-4 text-sm"
                placeholder="you@example.com"
                type="email"
                disabled={isEmailVerified}
                {...form.register('email')}
              />
              {getFieldError('email') && <span className="text-xs text-aq-error">{getFieldError('email')}</span>}
            </div>

            {/* Phone */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-phone">Phone Number</label>
              <input
                id="reg-phone"
                className="aq-input h-12 px-4 text-sm"
                placeholder="+91 98765 43210"
                type="tel"
                disabled={isEmailVerified}
                {...form.register('phone')}
              />
              {getFieldError('phone') && <span className="text-xs text-aq-error">{getFieldError('phone')}</span>}
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-password">Password</label>
              <div className="relative">
                <input
                  id="reg-password"
                  className="aq-input h-12 px-4 pr-12 text-sm w-full"
                  placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  disabled={isEmailVerified}
                  {...form.register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-aq-on-surface-variant hover:text-aq-primary hover:bg-aq-surface-container-high transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
              {getFieldError('password') && <span className="text-xs text-aq-error">{getFieldError('password')}</span>}
            </div>

            {/* Send OTP */}
            {!isEmailVerified && (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={isSendingOtp}
                className="aq-btn-secondary h-12 text-sm w-full mt-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                id="reg-send-otp"
              >
                {isSendingOtp && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSendingOtp ? 'Sending...' : hasSentOtp ? 'Resend Verification Code' : 'Send Verification Code'}
              </button>
            )}

            {/* OTP Section */}
            {hasSentOtp && !isEmailVerified && (
              <div className="flex flex-col gap-3 pt-4 border-t border-aq-outline-variant/20 mt-2 animate-fade-in-up">
                <div className="flex items-end gap-3">
                  <div className="flex-grow flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-aq-on-surface" htmlFor="reg-otp">Verification Code</label>
                    <input
                      id="reg-otp"
                      className="aq-input h-12 px-4 text-sm tracking-[0.3em] text-center font-mono"
                      placeholder="123456"
                      type="text"
                      maxLength={6}
                      disabled={isVerifyingOtp}
                      {...form.register('otp')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp}
                    className="aq-btn-primary h-12 px-6 text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    id="reg-verify-otp"
                  >
                    {isVerifyingOtp ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
                  </button>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="mt-2 flex flex-col gap-3">
              <button
                type="submit"
                disabled={!isEmailVerified || isRegistering}
                className="aq-btn-primary h-12 text-sm w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                id="reg-submit"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-center text-sm text-aq-on-surface-variant">
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-aq-primary hover:underline">
                  Sign In
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
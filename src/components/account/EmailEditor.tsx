'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Mail, CheckCircle2, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ALLOWED_EMAIL_DOMAINS } from '@/lib/constants';

const emailSchema = z.object({
  newEmail: z
    .string()
    .email({ message: 'Invalid email address' })
    .refine(
      (email) => {
        const domain = email.split('@')[1];
        return ALLOWED_EMAIL_DOMAINS.includes(domain);
      },
      { message: 'Please use a Gmail, Yahoo, Outlook, or iCloud email.' }
    )
    .transform((val) => val.trim().toLowerCase()),
});

const otpSchema = z.object({
  otp: z.string().length(6, { message: 'Verification code must be exactly 6 digits.' }),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type OtpFormValues = z.infer<typeof otpSchema>;

interface EmailEditorProps {
  currentEmail: string;
}

export default function EmailEditor({ currentEmail }: EmailEditorProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [targetEmail, setTargetEmail] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const { toast } = useToast();

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { newEmail: '' },
  });

  const otpForm = useForm<OtpFormValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: '' },
  });

  const handleSendOtp = async (data: EmailFormValues) => {
    if (data.newEmail === currentEmail) {
      emailForm.setError('newEmail', { message: 'New email cannot be the same as your current email.' });
      return;
    }

    setIsRequesting(true);
    try {
      const response = await fetch('/api/account/change-email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail: data.newEmail }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast({
          title: 'Request Failed',
          description: result.message || 'Failed to send verification code.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Verification Code Sent',
        description: 'Please check your new inbox for the 6-digit code.',
      });

      setTargetEmail(data.newEmail);
      setStep('verify');
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to connect to the server.',
        variant: 'destructive',
      });
    } finally {
      setIsRequesting(false);
    }
  };

  const handleVerifyOtp = async (data: OtpFormValues) => {
    setIsVerifying(true);
    try {
      const response = await fetch('/api/account/change-email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: data.otp }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast({
          title: 'Verification Failed',
          description: result.message || 'Invalid or expired code.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Email Updated Successfully',
        description: 'Logging you out. Please sign in with your new email.',
      });

      setOpen(false);
      
      // Log out user as the email has changed
      setTimeout(() => {
        signOut({ callbackUrl: '/login' });
      }, 1500);

    } catch {
      toast({
        title: 'Error',
        description: 'Failed to verify code.',
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const resetFlow = () => {
    setStep('request');
    setTargetEmail('');
    emailForm.reset({ newEmail: '' });
    otpForm.reset({ otp: '' });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetFlow();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-xl border-aq-outline/30 text-aq-on-surface-variant hover:bg-aq-surface-container hover:text-aq-primary transition-all"
          id="change-email-btn"
        >
          <Mail className="h-4 w-4" />
          Change Email
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-aq-surface border-aq-outline/20 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-aq-on-surface font-extrabold text-xl">
            Change Email
          </DialogTitle>
          <DialogDescription className="text-aq-on-surface-variant">
            {step === 'request'
              ? 'Enter your new email address. A verification code will be sent.'
              : `Verify ownership of ${targetEmail} using the 6-digit code.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'request' ? (
          <form onSubmit={emailForm.handleSubmit(handleSendOtp)} className="flex flex-col gap-5 mt-2">
            <div className="flex flex-col gap-2">
              <Label className="text-aq-on-surface font-semibold">Current Email</Label>
              <div className="text-sm font-medium text-aq-on-surface-variant bg-aq-surface-container p-3 rounded-xl border border-aq-outline-variant/15">
                {currentEmail}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="new-email" className="text-aq-on-surface font-semibold">
                New Email
              </Label>
              <Input
                id="new-email"
                placeholder="new.email@example.com"
                type="email"
                {...emailForm.register('newEmail')}
                className={`rounded-xl bg-aq-surface-container border-aq-outline/30 text-aq-on-surface placeholder:text-aq-outline focus-visible:ring-aq-primary ${
                  emailForm.formState.errors.newEmail ? 'border-red-500 focus-visible:ring-red-500' : ''
                }`}
              />
              {emailForm.formState.errors.newEmail && (
                <p className="text-xs text-red-500 mt-0.5">{emailForm.formState.errors.newEmail.message}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isRequesting}
              className="w-full rounded-xl bg-aq-gradient-primary text-white font-bold h-11 shadow-aq-sm hover:shadow-aq-md transition-all flex items-center justify-center gap-2"
              id="send-email-otp-btn"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending Code...
                </>
              ) : (
                <>
                  Send Code
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        ) : (
          <form onSubmit={otpForm.handleSubmit(handleVerifyOtp)} className="flex flex-col gap-5 mt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-otp" className="text-aq-on-surface font-semibold">
                Verification Code
              </Label>
              <Input
                id="email-otp"
                placeholder="123456"
                type="text"
                maxLength={6}
                {...otpForm.register('otp')}
                className={`rounded-xl bg-aq-surface-container border-aq-outline/30 text-aq-on-surface tracking-[0.2em] text-center font-mono placeholder:text-aq-outline focus-visible:ring-aq-primary ${
                  otpForm.formState.errors.otp ? 'border-red-500 focus-visible:ring-red-500' : ''
                }`}
              />
              {otpForm.formState.errors.otp && (
                <p className="text-xs text-red-500 mt-0.5">{otpForm.formState.errors.otp.message}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetFlow}
                disabled={isVerifying}
                className="flex-1 rounded-xl border-aq-outline/30 text-aq-on-surface-variant hover:bg-aq-surface-container transition-all"
              >
                Change Email
              </Button>
              <Button
                type="submit"
                disabled={isVerifying}
                className="flex-1 rounded-xl bg-aq-gradient-primary text-white font-bold shadow-aq-sm hover:shadow-aq-md transition-all flex items-center justify-center gap-2"
                id="verify-email-otp-btn"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Update'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

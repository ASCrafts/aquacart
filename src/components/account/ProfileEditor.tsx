'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

/**
 * Name, email and marketing consent, all in one dialog.
 *
 * R5 deleted the change-email flow entirely: email is optional and
 * unverified now, so there is no OTP ceremony left to have its own component
 * for. EmailEditor.tsx (which posted to the now-deleted
 * /api/account/change-email/* routes and imported the now-deleted
 * ALLOWED_EMAIL_DOMAINS constant) is gone; editing email lives here instead,
 * next to the other profile fields PUT /api/account/profile accepts.
 *
 * Phone is shown but not submitted. It is the proof of identity and the
 * contact of record — /api/account/profile rejects any change to it and
 * points the customer at support, so this form does not even try; asking for
 * a value it would just reject is worse than not asking.
 */

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Name must be at least 2 characters' })
    .max(50, { message: 'Name must be at most 50 characters' }),
  // Optional: an empty string clears the email server-side. z.literal('') has
  // to come first — z.string().email() rejects '' before the union gets a
  // chance to fall back to it.
  email: z.union([z.literal(''), z.string().trim().email({ message: 'That email address does not look right' })]),
  marketingConsent: z.boolean(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface ProfileEditorProps {
  defaultValues: {
    name: string;
    email: string;
    marketingConsent: boolean;
  };
  /** Display-only. Changing it here would just be rejected by the API. */
  phone: string;
}

export default function ProfileEditor({ defaultValues, phone }: ProfileEditorProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues,
  });

  const marketingConsent = watch('marketingConsent');

  const onSubmit = async (data: ProfileFormValues) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          marketingConsent: data.marketingConsent,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.errors) {
          const errorMessages = Object.values(result.errors).flat().join(', ');
          toast({ title: 'Validation Error', description: errorMessages, variant: 'destructive' });
        } else {
          toast({
            title: 'Error',
            description: result.message || 'Failed to update profile',
            variant: 'destructive',
          });
        }
        return;
      }

      toast({ title: 'Profile Updated', description: 'Your profile has been updated successfully.' });
      setOpen(false);
      router.refresh();
    } catch {
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) reset(defaultValues);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-xl border-aq-outline/30 text-aq-on-surface-variant hover:bg-aq-surface-container hover:text-aq-primary transition-all min-h-11"
          id="edit-profile-btn"
        >
          <Pencil className="h-4 w-4" />
          Edit Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-aq-surface border-aq-outline/20 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-aq-on-surface font-extrabold text-xl">
            Edit Profile
          </DialogTitle>
          <DialogDescription className="text-aq-on-surface-variant">
            Update your personal information below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5 mt-2">
          {/* Full Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name" className="text-aq-on-surface font-semibold">
              Full Name
            </Label>
            <Input
              id="profile-name"
              placeholder="John Doe"
              {...register('name')}
              className={`h-11 rounded-xl bg-aq-surface-container border-aq-outline/30 text-aq-on-surface placeholder:text-aq-outline focus-visible:ring-aq-primary ${
                errors.name ? 'border-red-500 focus-visible:ring-red-500' : ''
              }`}
            />
            {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name.message}</p>}
          </div>

          {/* Phone — read-only, proven by SMS at signup */}
          <div className="flex flex-col gap-2">
            <Label className="text-aq-on-surface font-semibold">Mobile Number</Label>
            <div className="h-11 flex items-center text-sm font-medium text-aq-on-surface-variant bg-aq-surface-container-high/60 px-3 rounded-xl border border-aq-outline-variant/15">
              {phone}
            </div>
            <p className="text-[11px] text-aq-on-surface-variant leading-snug">
              This is the number on every order. Contact support to change it — it needs a fresh SMS check.
            </p>
          </div>

          {/* Email — optional, unverified */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email" className="text-aq-on-surface font-semibold">
              Email <span className="font-normal text-aq-on-surface-variant">(optional)</span>
            </Label>
            <Input
              id="profile-email"
              type="email"
              placeholder="you@example.com"
              {...register('email')}
              className={`h-11 rounded-xl bg-aq-surface-container border-aq-outline/30 text-aq-on-surface placeholder:text-aq-outline focus-visible:ring-aq-primary ${
                errors.email ? 'border-red-500 focus-visible:ring-red-500' : ''
              }`}
            />
            {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email.message}</p>}
            <p className="text-[11px] text-aq-on-surface-variant leading-snug">
              Used for invoices only — nothing is gated on it, and it is not verified.
            </p>
          </div>

          {/* Marketing consent */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-aq-surface-container p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-aq-on-surface">Catch alerts &amp; offers</p>
              <p className="text-[11px] text-aq-on-surface-variant leading-snug mt-0.5">
                Told separately from order updates — turning this off never silences delivery tracking.
              </p>
            </div>
            <Switch
              checked={marketingConsent}
              onCheckedChange={(checked) => setValue('marketingConsent', checked, { shouldDirty: true })}
              aria-label="Marketing updates"
              className="shrink-0"
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-aq-gradient-primary text-white font-bold h-11 shadow-aq-sm hover:shadow-aq-md transition-all"
            id="save-profile-btn"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

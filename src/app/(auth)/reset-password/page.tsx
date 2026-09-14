import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Reset Password | AquaCart',
  description: 'Set a new password for your AquaCart account.',
};

/**
 * Kept alive only for the links already out in the world.
 *
 * Resets now happen entirely on /forgot-password, where the SMS proof is passed
 * to ResetPasswordForm in memory. Rendered here with no props, the form has no
 * proof to work with and says so plainly — a stale `?token=...` link lands on
 * an explanation and a way forward rather than a password box that would fail
 * on submit. The old token is deliberately not read: it no longer means
 * anything, and pretending to inspect it would only invite trusting it.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}

import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Forgot Password | AquaCart',
  description: 'Reset your AquaCart password by confirming your mobile number.',
};

/**
 * The whole reset lives on this one page: number, SMS code, new password.
 * There is no emailed link to come back from, so there is no second URL and no
 * token in a query string.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

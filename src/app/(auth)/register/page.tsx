import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create Account | AquaCart',
  description: 'Sign up with your mobile number and start ordering fresh catch.',
};

/**
 * No Suspense boundary here, unlike /login: RegisterForm reads nothing from the
 * URL, so there is no useSearchParams() call to force this route out of the
 * prerender.
 */
export default function RegisterPage() {
  return <RegisterForm />;
}

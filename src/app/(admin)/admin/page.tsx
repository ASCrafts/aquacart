import { redirect } from 'next/navigation';

/**
 * /admin is the sheet.
 *
 * R3 makes "Today's stock" the landing page, so this route exists only to
 * catch the bookmark, the muscle memory and the old links. The redirect is
 * unconditional and the gate lives one hop away on /admin/stock: doing the
 * auth check here as well would duplicate it, and duplicating an auth check is
 * how the two copies end up disagreeing.
 */
export default function AdminPage() {
  redirect('/admin/stock');
}

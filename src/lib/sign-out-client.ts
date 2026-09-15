import { getSession, signOut } from 'next-auth/react';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign out, make sure it stuck, then go to /login inside the app.
 *
 * Two traps this exists for:
 *
 * 1. A late response can resurrect the session. Auth.js re-issues the JWT
 *    session cookie on every session read, and the auth middleware appends
 *    that cookie to ordinary page responses too. A request that set off with
 *    the old cookie before the sign-out — typically a link prefetch started
 *    when the header menu opened — can land after the sign-out's delete and
 *    put the cookie straight back. So: re-check, and sign out again if it
 *    returned, until two reads in a row come back empty.
 *
 * 2. NextAuth's own redirect is an absolute URL built from AUTH_URL. When that
 *    host differs from the one the PWA was installed from, the installed app
 *    opens the login page in a browser tab with a URL bar. A relative replace
 *    cannot leave the app, and keeps the signed-in page out of Back history.
 */
export async function signOutToLogin(): Promise<void> {
  await signOut({ redirect: false });

  let cleanReads = 0;
  for (let attempt = 0; attempt < 10 && cleanReads < 2; attempt += 1) {
    await sleep(300);
    const session = await getSession();
    if (session?.user) {
      cleanReads = 0;
      await signOut({ redirect: false });
    } else {
      cleanReads += 1;
    }
  }

  window.location.replace('/login');
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Loader2,
  Megaphone,
  Share,
  ShieldCheck,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  checkPushAvailability,
  disablePush,
  enablePush,
  type PushAvailability,
} from '@/lib/push-client';

/**
 * The opt-in card.
 *
 * Three things this component exists to get right, none of which are visual:
 *
 * 1. **It never asks on load.** The permission prompt is fired from the button's
 *    click handler and nowhere else. See the argument at the top of
 *    src/lib/push-client.ts: there is one chance to ask, and a denial is close
 *    to permanent.
 *
 * 2. **It detects the iOS tab case instead of failing silently.** iOS exposes
 *    the Push API only to a web app installed to the Home Screen (16.4+). In
 *    Safari's browser tab there is no `Notification`, no prompt, and no error
 *    worth showing — a button here would look like it worked and then never
 *    deliver anything. That case gets instructions, not a button.
 *
 * 3. **It keeps the two channels visibly separate.** Order tracking is
 *    transactional and is what the customer came for; offers are marketing,
 *    capped at one a day and held outside 21:00–06:00 IST. They are stored in
 *    different places (a PushDevice row vs `User.marketingConsent`) and turning
 *    offers off must never turn order updates off. If the UI implied otherwise,
 *    customers would refuse both to escape one.
 */

/**
 * Whether THIS browser has a device row on the server.
 *
 * Kept locally because the server cannot answer it: it knows the account's
 * tokens, not which of them belongs to the browser asking. `Notification.
 * permission` alone is not the answer either — it stays 'granted' after the row
 * is deleted, which would leave the toggle stuck on. If this flag is lost
 * (cleared storage, a new profile), the card shows "off" and pressing it
 * re-registers with no prompt, which costs one tap and nothing else.
 */
const DEVICE_FLAG_KEY = 'aq.push.device.v1';

function readDeviceFlag(): boolean {
  try {
    return window.localStorage.getItem(DEVICE_FLAG_KEY) === '1';
  } catch {
    // Private mode. The card still works; it just cannot remember.
    return false;
  }
}

function writeDeviceFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEVICE_FLAG_KEY, '1');
    else window.localStorage.removeItem(DEVICE_FLAG_KEY);
  } catch {
    /* nothing to do — the toggle is still correct for this session */
  }
}

export default function PushOptIn({ className }: { className?: string }) {
  const { status } = useSession();
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [deviceOn, setDeviceOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [savingMarketing, setSavingMarketing] = useState(false);

  // A tab left open through a sign-out, or an unmount mid-request, must not set
  // state on a dead component or write a device flag for a session that ended.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* --------------------------------------------------- what is possible */

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    // Passive checks only — reads `Notification.permission`, feature-detects,
    // and prompts nothing.
    void checkPushAvailability().then((result) => {
      if (cancelled) return;
      setAvailability(result);
      setDeviceOn(result.state === 'granted' && readDeviceFlag());
    });

    return () => {
      cancelled = true;
    };
  }, [status]);

  /* ------------------------------------------------- marketing consent */

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/account/profile', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as { user?: { marketingConsent?: boolean } };
        if (!cancelled) setMarketing(Boolean(data.user?.marketingConsent));
      } catch {
        // Leave it null: an unknown consent renders as a disabled switch rather
        // than as "off", because showing "off" for a customer who opted in is a
        // lie that they will then switch on again, resetting their consent date.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  const toggleMarketing = useCallback(
    async (next: boolean) => {
      const previous = marketing;
      setMarketing(next);
      setSavingMarketing(true);
      try {
        const response = await fetch('/api/account/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketingConsent: next }),
        });
        if (!response.ok) throw new Error('save failed');
        toast({
          title: next ? 'Catch alerts on' : 'Catch alerts off',
          description: next
            ? 'One message a day at most, never between 9 PM and 6 AM.'
            : 'Order updates are unaffected — you will still hear about your deliveries.',
        });
      } catch {
        // Rolled back rather than left optimistic: consent is a legal record,
        // and a switch that shows "on" for a row that says "off" is the worst
        // of both worlds.
        if (alive.current) setMarketing(previous);
        toast({
          variant: 'destructive',
          title: 'Could not save that',
          description: 'Check your connection and try again.',
        });
      } finally {
        if (alive.current) setSavingMarketing(false);
      }
    },
    [marketing]
  );

  /* ----------------------------------------------------- the device itself */

  const turnOn = useCallback(async () => {
    setBusy(true);
    // Called straight from the click handler — the browser requires the gesture
    // and there is no await before the prompt that could lose it.
    const result = await enablePush();
    if (!alive.current) return;

    if (result.ok) {
      writeDeviceFlag(true);
      setDeviceOn(true);
      setAvailability({ state: 'granted' });
      toast({
        title: 'Notifications on',
        description: 'We will tell you when your order is packed and on its way.',
      });
    } else {
      if (result.reason === 'blocked') setAvailability({ state: 'blocked' });
      if (result.reason === 'ios-needs-install') setAvailability({ state: 'ios-needs-install' });
      // 'dismissed' is not a failure worth shouting about: the prompt can be
      // shown again, so the card simply stays as it was.
      if (result.reason !== 'dismissed') {
        toast({
          variant: 'destructive',
          title: 'Notifications are not on',
          description: result.message,
        });
      }
    }
    setBusy(false);
  }, []);

  const turnOff = useCallback(async () => {
    setBusy(true);
    const ok = await disablePush();
    if (!alive.current) return;

    // The flag is cleared either way. If the server call failed, the truthful
    // state for this browser is still "we tried to stop", and register() is
    // idempotent if they turn it back on.
    writeDeviceFlag(false);
    setDeviceOn(false);
    setBusy(false);
    toast({
      title: 'Notifications off',
      description: ok
        ? 'This device will not get push notifications. Your orders are still in Your Account.'
        : 'Turned off on this device. We could not reach the server, so it may take a moment.',
    });
  }, []);

  /* --------------------------------------------------------------- render */

  // Nothing to opt into if nobody is signed in — there is no account to attach
  // a device to. The card is rendered by account surfaces, which are gated
  // anyway; this is the belt for that pair of braces.
  if (status !== 'authenticated') return null;

  const state = availability?.state;
  const loading = availability === null;

  return (
    <section
      className={cn('aq-card-static overflow-hidden', className)}
      aria-labelledby="push-opt-in-title"
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            deviceOn ? 'bg-aq-tertiary-fixed text-aq-tertiary' : 'bg-aq-primary-fixed text-aq-primary'
          )}
          aria-hidden
        >
          {deviceOn ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <h2 id="push-opt-in-title" className="text-base font-bold text-aq-on-surface">
            Order updates on this device
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-aq-on-surface-variant">
            Packed, out for delivery, delivered — and the one message that matters most, if the
            catch comes up short and we need your answer before 8 AM.
          </p>

          {/* ---- The device switch, or the reason there isn't one ---- */}
          <div className="mt-3">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-aq-on-surface-variant">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Checking this device…
              </p>
            ) : state === 'ios-needs-install' ? (
              /* The case this component exists for. No button: on an iOS tab
                 the prompt never appears, so a button would be a lie. */
              <div className="rounded-xl bg-aq-surface-container p-3">
                <p className="flex items-start gap-2 text-sm font-semibold text-aq-on-surface">
                  <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Add AquaCart to your Home Screen first
                </p>
                <ol className="mt-2 list-inside list-decimal space-y-1 text-sm leading-relaxed text-aq-on-surface-variant">
                  <li>Tap the Share button in Safari.</li>
                  <li>Choose &ldquo;Add to Home Screen&rdquo;.</li>
                  <li>Open AquaCart from the new icon and come back here.</li>
                </ol>
                <p className="mt-2 text-xs leading-relaxed text-aq-on-surface-variant">
                  Apple only allows notifications for installed web apps (iOS 16.4 and later). In a
                  Safari tab they cannot be delivered at all — which is why there is no button here
                  rather than one that quietly does nothing.
                </p>
              </div>
            ) : state === 'blocked' ? (
              <p className="flex items-start gap-2 rounded-xl bg-aq-error-container/50 p-3 text-sm leading-relaxed text-aq-on-surface">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-aq-error" aria-hidden />
                <span>
                  Notifications are blocked for this site in your browser settings. Allow them for
                  AquaCart there, then come back and turn them on.
                </span>
              </p>
            ) : state === 'unsupported' || state === 'misconfigured' ? (
              <p className="rounded-xl bg-aq-surface-container p-3 text-sm leading-relaxed text-aq-on-surface-variant">
                {state === 'unsupported'
                  ? 'This browser cannot receive notifications. Your order updates are always in Your Account.'
                  : 'Notifications are not configured on this deployment yet.'}
              </p>
            ) : (
              <button
                type="button"
                onClick={deviceOn ? turnOff : turnOn}
                disabled={busy}
                className={cn(
                  'touch-target inline-flex w-full items-center justify-center gap-2 px-5 text-sm sm:w-auto',
                  deviceOn ? 'aq-btn-outline' : 'aq-btn-primary',
                  busy && 'opacity-60'
                )}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : deviceOn ? (
                  <BellOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Bell className="h-4 w-4" aria-hidden />
                )}
                {deviceOn ? 'Turn off on this device' : 'Turn on notifications'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- Marketing, fenced off ----
          A separate block with its own heading and its own store. The sentence
          under the switch is the whole point of the separation and is worth the
          line it costs: customers who fear that declining offers will cost them
          delivery updates decline everything. */}
      <div className="border-t border-aq-outline-variant/50 bg-aq-surface-container-low p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3
              id="marketing-consent-label"
              className="flex items-center gap-2 text-sm font-bold text-aq-on-surface"
            >
              <Megaphone className="h-4 w-4 text-aq-primary" aria-hidden />
              Tell me when a good catch lands
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-aq-on-surface-variant">
              &ldquo;வஞ்சிரம் just landed — 12 kg, ₹1,200/kg. Order before 7:30 PM for delivery
              today.&rdquo; At most one a day, never between 9 PM and 6 AM.
            </p>
          </div>

          {/* The switch itself is 24px tall by design. Wrapping it in its own
              <label> is what makes the tap target 44px on a phone: a tap
              anywhere in the padded label is forwarded to the control, which a
              plain padded <span> would not do. The visible name comes from the
              heading via aria-labelledby, so the label carries no text of its
              own to repeat. */}
          <label
            htmlFor="marketing-consent"
            className="touch-target -mr-2 flex shrink-0 cursor-pointer items-center justify-center px-2"
          >
            <Switch
              id="marketing-consent"
              checked={marketing === true}
              disabled={marketing === null || savingMarketing}
              onCheckedChange={(next) => void toggleMarketing(next)}
              aria-labelledby="marketing-consent-label"
              aria-describedby="marketing-separate"
            />
          </label>
        </div>

        <p
          id="marketing-separate"
          className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-aq-on-surface-variant"
        >
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aq-tertiary" aria-hidden />
          <span>
            This is separate from order updates. Turning it off stops the offers and changes nothing
            about your deliveries — you will still hear when an order is on its way, and if a catch
            is short.
          </span>
        </p>
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  Clock,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ROLES, WS_EVENT } from '@/lib/constants';

/**
 * The admin live feed.
 *
 * Two things this component has to get right, per artifact.md R6:
 *
 *   1. The socket is fast and is NOT a delivery guarantee. Every (re)connect —
 *      including the very first one — refetches everything since the newest
 *      order id this browser has ever seen, via `/api/admin/orders?sinceId=`.
 *      That id is kept in localStorage so a page reload does not forget it and
 *      re-show orders that were already acted on.
 *   2. Reconnects back off exponentially with jitter, capped at ~30s, so a
 *      dead WebSocket server does not turn a laptop's open dashboard tab into
 *      a reconnect flood.
 *
 * The channel also carries `shortfall` and `undeclared_nudge` events, which
 * are not "an order happened" and are rendered with distinct treatment: a
 * short-fall is money at risk and gets error styling; an undeclared nudge is a
 * reminder and gets a calmer one.
 */

// ---------------------------------------------------------------------------
// Reconnect backoff
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 30_000;

/**
 * Equal jitter, capped at ~30s: half the exponential value is fixed, half is
 * random. Full jitter (0..exp) was considered and rejected — at attempt 0 it
 * can return a delay near zero, which would hot-loop against a server that is
 * rejecting every attempt outright (an expired admin token, say) rather than
 * merely being unreachable.
 */
function backoffDelayMs(attempt: number): number {
  const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempt);
  return exp / 2 + Math.random() * (exp / 2);
}

// ---------------------------------------------------------------------------
// Last-seen-order-id, persisted
// ---------------------------------------------------------------------------

const LAST_SEEN_KEY = 'aq.admin.lastSeenOrderId.v1';

function readLastSeenId(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null; // private window / blocked storage — resync from scratch
  }
}

function writeLastSeenId(id: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, id);
  } catch {
    /* nothing to do — this tab just resyncs a little wider next time */
  }
}

// ---------------------------------------------------------------------------
// Feed types
// ---------------------------------------------------------------------------

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface OrderFeedItem {
  id: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  orderStatus: string | null;
  fulfilDay: string | null;
  slot: string | null;
  createdAt: string;
}

interface ShortfallAlert {
  key: string;
  receivedAt: string;
  kind: string;
  orderId: string | null;
  orderItemId: string | null;
  day: string | null;
  fromName: string | null;
  fromKg: number | null;
  toName: string | null;
  toKg: number | null;
  refunded: number | null;
}

interface UndeclaredNudge {
  key: string;
  receivedAt: string;
  day: string | null;
  count: number | null;
  names: string[];
}

const FEED_LIMIT = 50;
const SHORTFALL_LIMIT = 20;
const NUDGE_LIMIT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** From the admin orders API — `/api/admin/orders`. */
function apiOrderToFeedItem(raw: unknown): OrderFeedItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    customerName: typeof raw.customerName === 'string' ? raw.customerName : 'Customer',
    customerPhone: typeof raw.customerPhone === 'string' ? raw.customerPhone : '',
    totalAmount: typeof raw.totalAmount === 'number' ? raw.totalAmount : 0,
    orderStatus: typeof raw.orderStatus === 'string' ? raw.orderStatus : null,
    fulfilDay: typeof raw.fulfilDay === 'string' ? raw.fulfilDay : null,
    slot: typeof raw.slot === 'string' ? raw.slot : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

/** From the WebSocket `new_order` push — see broadcastToAdmins(WS_EVENT.NEW_ORDER, ...). */
function wsPayloadToFeedItem(payload: unknown): OrderFeedItem | null {
  if (!isRecord(payload) || typeof payload.orderId !== 'string') return null;
  return {
    id: payload.orderId,
    customerName: typeof payload.customerName === 'string' ? payload.customerName : 'Customer',
    customerPhone: typeof payload.customerPhone === 'string' ? payload.customerPhone : '',
    totalAmount: typeof payload.totalAmount === 'number' ? payload.totalAmount : 0,
    orderStatus: null,
    fulfilDay: typeof payload.fulfilDay === 'string' ? payload.fulfilDay : null,
    slot: typeof payload.slot === 'string' ? payload.slot : null,
    createdAt: typeof payload.paidAt === 'string' ? payload.paidAt : new Date().toISOString(),
  };
}

function toShortfallAlert(payload: unknown): ShortfallAlert {
  const body = isRecord(payload) ? payload : {};
  const from = isRecord(body.from) ? body.from : {};
  const to = isRecord(body.to) ? body.to : {};
  return {
    key: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    kind: typeof body.kind === 'string' ? body.kind : 'shortfall',
    orderId: typeof body.orderId === 'string' ? body.orderId : null,
    orderItemId: typeof body.orderItemId === 'string' ? body.orderItemId : null,
    day: typeof body.day === 'string' ? body.day : null,
    fromName: typeof from.name === 'string' ? from.name : null,
    fromKg: typeof from.kg === 'number' ? from.kg : null,
    toName: typeof to.name === 'string' ? to.name : null,
    toKg: typeof to.kg === 'number' ? to.kg : null,
    refunded: typeof body.refunded === 'number' ? body.refunded : null,
  };
}

function toUndeclaredNudge(payload: unknown): UndeclaredNudge {
  const body = isRecord(payload) ? payload : {};
  return {
    key: `nudge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    day: typeof body.day === 'string' ? body.day : null,
    count: typeof body.count === 'number' ? body.count : null,
    names: Array.isArray(body.names)
      ? body.names.filter((n): n is string => typeof n === 'string')
      : [],
  };
}

/** Merge by id, newest `createdAt` first, capped so the feed cannot grow forever. */
function mergeFeed(prev: OrderFeedItem[], incoming: OrderFeedItem[]): OrderFeedItem[] {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, { ...byId.get(item.id), ...item });
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, FEED_LIMIT);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const { data: session } = useSession();
  const { toast } = useToast();

  const accessToken = session?.accessToken;
  const userRole = session?.user?.role;

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [feed, setFeed] = useState<OrderFeedItem[]>([]);
  const [shortfalls, setShortfalls] = useState<ShortfallAlert[]>([]);
  const [nudges, setNudges] = useState<UndeclaredNudge[]>([]);
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);

  // The WebSocket effect below only re-runs when the token/role change, not on
  // every order — so it reads the newest known id through a ref rather than a
  // stale closure over `lastSeenId`.
  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastSeenIdRef.current = lastSeenId;
  }, [lastSeenId]);

  // Hydrate from localStorage once on mount (not during SSR).
  useEffect(() => {
    setLastSeenId(readLastSeenId());
  }, []);

  const updateLastSeenId = useCallback((id: string | null | undefined) => {
    if (!id) return;
    lastSeenIdRef.current = id;
    setLastSeenId(id);
    writeLastSeenId(id);
  }, []);

  /**
   * Refetch everything since the newest order id this browser has ever seen.
   * Called on every (re)connect, including the first — with no id yet, that is
   * simply the most recent page, which is what actually populates the
   * dashboard instead of leaving it empty until the next live push.
   */
  const syncSince = useCallback(
    async (announce: boolean) => {
      setSyncing(true);
      try {
        const sinceId = lastSeenIdRef.current;
        const qs = new URLSearchParams({ limit: '50' });
        if (sinceId) qs.set('sinceId', sinceId);

        const res = await fetch(`/api/admin/orders?${qs.toString()}`, { cache: 'no-store' });
        if (!res.ok) return;

        const data = (await res.json()) as {
          orders?: unknown[];
          cursor?: { lastId?: string | null };
        };
        const items = (data.orders ?? [])
          .map(apiOrderToFeedItem)
          .filter((o): o is OrderFeedItem => o !== null);

        if (items.length) {
          setFeed((prev) => mergeFeed(prev, items));
          if (announce && sinceId) {
            toast({
              title: `Synced ${items.length} order${items.length === 1 ? '' : 's'}`,
              description: 'Caught up on everything since this dashboard was last connected.',
            });
          }
        }

        if (data.cursor?.lastId) updateLastSeenId(data.cursor.lastId);
      } catch (err) {
        console.warn('[admin] order sync failed:', err);
      } finally {
        setSyncing(false);
      }
    },
    [toast, updateLastSeenId]
  );

  // ------------------------------------------------------- the socket itself

  useEffect(() => {
    if (userRole !== ROLES.ADMIN || !accessToken) {
      setConnection('disconnected');
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WSS_URL;
    if (!wsUrl) {
      console.error('NEXT_PUBLIC_WSS_URL is not defined');
      setConnection('disconnected');
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let hasConnectedBefore = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = backoffDelayMs(attempt);
      attempt += 1;
      setReconnectAttempt(attempt);
      setConnection('reconnecting');
      clearReconnectTimer();
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (cancelled) return;
      setConnection(hasConnectedBefore ? 'reconnecting' : 'connecting');

      const instance = new WebSocket(`${wsUrl}?token=${accessToken}`);
      socket = instance;

      instance.onopen = () => {
        if (cancelled) return;
        const isReconnect = hasConnectedBefore;
        hasConnectedBefore = true;
        attempt = 0;
        setReconnectAttempt(0);
        setConnection('connected');

        void syncSince(isReconnect);

        if (!isReconnect) {
          toast({
            title: 'Live notifications active',
            description: 'You are connected to the live order feed.',
          });
        } else {
          toast({ title: 'Reconnected', description: 'Syncing anything you missed…' });
        }
      };

      instance.onmessage = (event) => {
        if (cancelled) return;
        let parsed: { type?: unknown; payload?: unknown };
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const type = typeof parsed.type === 'string' ? parsed.type : '';

        switch (type) {
          case WS_EVENT.NEW_ORDER: {
            const item = wsPayloadToFeedItem(parsed.payload);
            if (!item) break;
            setFeed((prev) => mergeFeed(prev, [item]));
            // Opportunistic: a live "new order" push is, by construction, an
            // order that was just created, so it is safe to treat as the
            // newest seen. The next reconnect's sync is still the
            // authoritative source (cursor.lastId), in case pushes arrive out
            // of order under a flaky connection.
            updateLastSeenId(item.id);
            toast({
              title: '🎉 New order received!',
              description: `From ${item.customerName} for ₹${item.totalAmount.toFixed(2)}.`,
            });
            break;
          }
          case WS_EVENT.SHORTFALL: {
            const alert = toShortfallAlert(parsed.payload);
            setShortfalls((prev) => [alert, ...prev].slice(0, SHORTFALL_LIMIT));
            toast({
              variant: 'destructive',
              title: 'Short-fall notice',
              description:
                alert.kind === 'substitute' && alert.fromName && alert.toName
                  ? `${alert.fromName} → ${alert.toName} for order ${alert.orderId ?? '—'}.`
                  : `Order ${alert.orderId ?? '—'} needs attention.`,
            });
            break;
          }
          case WS_EVENT.UNDECLARED_NUDGE: {
            const nudge = toUndeclaredNudge(parsed.payload);
            setNudges((prev) => [nudge, ...prev].slice(0, NUDGE_LIMIT));
            toast({
              title: 'Catch not yet declared',
              description: `${nudge.count ?? 'Some'} product${nudge.count === 1 ? '' : 's'} still undeclared for ${nudge.day ?? 'today'}.`,
            });
            break;
          }
          case WS_EVENT.CONNECTION_ACK:
          default:
            break;
        }
      };

      instance.onclose = () => {
        if (cancelled) return;
        scheduleReconnect();
      };

      // onclose always follows onerror for a browser WebSocket, so the actual
      // reconnect scheduling lives there and this just keeps the console quiet
      // during React Strict Mode's intentional connect/abort cycle in dev.
      instance.onerror = () => {
        /* handled by onclose */
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    };
  }, [accessToken, userRole, toast, syncSince, updateLastSeenId]);

  // ------------------------------------------------------------------ render

  const statusMeta: Record<
    ConnectionState,
    { icon: typeof Wifi; label: string; className: string }
  > = {
    connected: { icon: Wifi, label: 'Live', className: 'text-aq-tertiary' },
    connecting: { icon: Loader2, label: 'Connecting', className: 'text-aq-primary' },
    reconnecting: {
      icon: RefreshCw,
      label: reconnectAttempt > 1 ? `Reconnecting (${reconnectAttempt})` : 'Reconnecting',
      className: 'text-amber-600',
    },
    disconnected: { icon: WifiOff, label: 'Offline', className: 'text-aq-error' },
  };
  const status = statusMeta[connection];
  const StatusIcon = status.icon;
  // Spin the icon only. Spinning the whole label rotated the text itself.
  const spinning = connection === 'connecting' || connection === 'reconnecting';

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
            <span>Live feed</span>
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${status.className}`}>
              <StatusIcon
                className={`h-4 w-4 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden
              />
              {status.label}
            </span>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>New orders appear here in real time; a reconnect catches up on anything missed.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target h-8 gap-1.5 px-2 text-xs"
              disabled={syncing}
              onClick={() => void syncSince(true)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              Sync now
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Undeclared nudge — a reminder, not a crisis. Calm treatment. */}
          {nudges.map((nudge) => (
            <div
              key={nudge.key}
              className="flex items-start gap-3 rounded-xl border border-aq-outline-variant bg-aq-surface-container-low p-3"
            >
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-aq-primary" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold text-aq-on-surface">
                  {nudge.count ?? 'Some'} product{nudge.count === 1 ? '' : 's'} still undeclared
                  {nudge.day ? ` for ${nudge.day}` : ''}
                </p>
                {nudge.names.length > 0 && (
                  <p className="mt-0.5 text-aq-on-surface-variant">{nudge.names.join(', ')}</p>
                )}
                <Link href="/admin/stock" className="mt-1 inline-block text-sm font-bold text-aq-primary hover:underline">
                  Go declare the catch →
                </Link>
              </div>
            </div>
          ))}

          {/* Short-fall notices — money at risk. Error treatment. */}
          {shortfalls.map((alert) => (
            <div
              key={alert.key}
              className="flex items-start gap-3 rounded-xl border border-aq-error/40 bg-aq-error-container p-3"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-aq-error" aria-hidden />
              <div className="min-w-0 flex-1 text-sm text-aq-on-surface">
                <p className="font-bold">
                  Short-fall{alert.kind && alert.kind !== 'shortfall' ? ` — ${alert.kind}` : ''}
                </p>
                {alert.fromName && alert.toName ? (
                  <p className="mt-0.5">
                    {alert.fromName}
                    {alert.fromKg != null ? ` (${alert.fromKg} kg)` : ''} → {alert.toName}
                    {alert.toKg != null ? ` (${alert.toKg} kg)` : ''}
                  </p>
                ) : null}
                {alert.refunded != null && (
                  <p className="mt-0.5">Refunded ₹{alert.refunded.toFixed(2)}</p>
                )}
                <p className="mt-1 text-xs text-aq-on-surface-variant">
                  Order {alert.orderId ?? '—'}
                  {alert.day ? ` · ${alert.day}` : ''}
                </p>
              </div>
            </div>
          ))}

          {feed.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-aq-surface-container-low px-4 py-3">
              <Bell className="h-5 w-5 shrink-0 text-aq-on-surface-variant" aria-hidden />
              <p className="text-sm text-aq-on-surface-variant">
                {syncing ? 'Loading recent orders…' : 'No new orders yet. They appear here as they come in.'}
              </p>
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {feed.map((order) => (
                <div
                  key={order.id}
                  className="aq-card-static animate-in fade-in-0 slide-in-from-top-5 p-4 duration-500"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-aq-on-surface">
                        Order #{order.id.slice(-6)}
                      </p>
                      <p className="text-sm text-aq-on-surface-variant">From: {order.customerName}</p>
                      <p className="text-sm text-aq-on-surface-variant">Phone: {order.customerPhone}</p>
                      {(order.fulfilDay || order.orderStatus) && (
                        <p className="mt-1 text-xs text-aq-on-surface-variant">
                          {order.orderStatus ?? ''}
                          {order.orderStatus && order.fulfilDay ? ' · ' : ''}
                          {order.fulfilDay ?? ''}
                          {order.slot ? ` (${order.slot})` : ''}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-xl font-extrabold text-aq-primary">
                      ₹{order.totalAmount.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

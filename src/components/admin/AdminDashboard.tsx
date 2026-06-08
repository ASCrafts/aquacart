'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Bell, CheckCircle, Circle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

type OrderNotification = {
  orderId: string;
  totalPrice: number;
  customerName: string;
  customerPhone: string;
};

export default function AdminDashboard() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  // Extract primitive values for stable dependencies
  const accessToken = session?.accessToken;
  const userRole = session?.user?.role;

  useEffect(() => {
    // Only proceed if user is admin and we have a token
    if (userRole !== 'admin' || !accessToken) {
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WSS_URL;
    if (!wsUrl) {
      console.error('NEXT_PUBLIC_WSS_URL is not defined');
      setWsStatus('disconnected');
      return;
    }

    // Define connection logic inside the effect
    console.log('Initializing WebSocket connection...');
    const ws = new WebSocket(`${wsUrl}?token=${accessToken}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_order') {
          const newOrder: OrderNotification = data.payload;
          setNotifications((prev) => [newOrder, ...prev]);
          toast({
            title: '🎉 New Order Received!',
            description: `From ${newOrder.customerName} for $${newOrder.totalPrice.toFixed(2)}.`,
          });
        } else if (data.type === 'connection_ack') {
          toast({
            title: 'Live Notifications Active',
            description: 'You are connected to the live order feed.',
          });
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsStatus('disconnected');
    };

    ws.onerror = () => {
      // Muted error logging here because React Strict Mode intentionally 
      // connects and aborts the connection repeatedly during dev, throwing fake errors.
      setWsStatus('disconnected');
    };

    // Cleanup function to close connection when component unmounts or deps change
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [accessToken, userRole, toast]); // Dependencies are now stable primitives

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Live Order Feed</span>
          {wsStatus === 'connected' && (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
          {wsStatus === 'connecting' && (
            <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
          )}
          {wsStatus === 'disconnected' && (
            <Circle className="h-5 w-5 text-red-500" />
          )}
        </CardTitle>
        <CardDescription>
          New orders will appear here in real-time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <Bell className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              Waiting for new orders...
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-4">
            {notifications.map((order) => (
              <div
                key={order.orderId}
                className="p-4 border rounded-lg bg-card shadow-sm animate-in fade-in-0 slide-in-from-top-5 duration-500"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-lg">
                      Order #{order.orderId.slice(-6)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      From: {order.customerName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Phone: {order.customerPhone}
                    </p>
                  </div>
                  <p className="text-xl font-extrabold text-primary">
                    ₹{order.totalPrice.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Order Management Link */}
    <div className="mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Order Management</CardTitle>
          <CardDescription>
            View and manage all customer orders, refunds, and cancellations in the dedicated order management portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full sm:w-auto">
            <Link href="/admin/orders">Go to Order Management</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
import AddressManager from "@/components/account/AddressManager";
import OrderHistory from "@/components/account/OrderHistory";
import ProfileEditor from "@/components/account/ProfileEditor";
import EmailEditor from "@/components/account/EmailEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth } from "@/lib/auth";
import dbConnect from "@/lib/mongodb";
import OrderModel from "@/models/Order";
import UserModel from "@/models/User";
import { Home, Package, User as UserIcon } from "lucide-react";

async function getAccountData() {
  const session = await auth();
  if (!session?.user?.id) return { user: null, orders: [] };
  await dbConnect();
  const user = await UserModel.findById(session.user.id).select('name email phone addresses').lean();
  const orders = await OrderModel.find({ userId: session.user.id }).sort({ createdAt: -1 }).lean();
  return {
    user: JSON.parse(JSON.stringify(user)),
    orders: JSON.parse(JSON.stringify(orders)),
  };
}

export default async function AccountPage() {
  const { user, orders } = await getAccountData();

  if (!user) {
    return (
      <div className="container py-20 text-center">
        <p className="text-aq-on-surface-variant">Please log in to view your account.</p>
      </div>
    );
  }

  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        {/* Profile Header */}
        <div className="aq-card-static p-6 md:p-8 mb-6 flex flex-col sm:flex-row items-center gap-5" id="profile-header">
          <div className="w-20 h-20 rounded-2xl bg-aq-gradient-primary flex items-center justify-center shadow-aq-md">
            <span className="text-3xl font-extrabold text-white">
              {user.name?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
          <div className="text-center sm:text-left flex-1">
            <h1 className="text-2xl font-extrabold text-aq-on-surface tracking-tight">{user.name}</h1>
            <p className="text-sm text-aq-on-surface-variant mt-0.5">{user.email}</p>
            {user.phone && (
              <p className="text-xs text-aq-outline mt-1">{user.phone}</p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <ProfileEditor defaultValues={{ name: user.name || '', phone: user.phone || '' }} />
            <EmailEditor currentEmail={user.email} />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="orders" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-aq-surface-container rounded-xl h-12 p-1">
            <TabsTrigger
              value="orders"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-aq-sm data-[state=active]:text-aq-primary font-semibold text-sm transition-all"
            >
              <Package className="mr-2 h-4 w-4" />
              Orders
            </TabsTrigger>
            <TabsTrigger
              value="addresses"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-aq-sm data-[state=active]:text-aq-primary font-semibold text-sm transition-all"
            >
              <Home className="mr-2 h-4 w-4" />
              Addresses
            </TabsTrigger>
          </TabsList>
          <TabsContent value="orders" className="mt-4">
            <OrderHistory />
          </TabsContent>
          <TabsContent value="addresses" className="mt-4">
            <AddressManager initialAddresses={user.addresses} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

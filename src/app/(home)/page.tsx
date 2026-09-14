import { auth } from "@/lib/auth";
import GuestLanding from "@/components/home/GuestLanding";
import UserHome from "@/components/home/UserHome";
import { getFreshCatches } from "@/lib/products";

export default async function HomePage() {
  const session = await auth();

  if (session) {
    // Fetched here rather than in the client component: it is a stock-aware
    // read (viewFor() against today's DayStock row), so it must never be
    // cached the way the catalog is — see the comment on getShopListing().
    const freshStock = await getFreshCatches();
    // If logged in, show the AquaFresh Home Dashboard
    return <UserHome freshStock={freshStock} />;
  } else {
    // If NOT logged in, show the Fresh Catch Landing Page
    return <GuestLanding />;
  }
}
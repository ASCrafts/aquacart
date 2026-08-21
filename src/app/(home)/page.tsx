import { auth } from "@/lib/auth";
import GuestLanding from "@/components/home/GuestLanding";
import UserHome from "@/components/home/UserHome";
import { getFreshStock } from "@/lib/products";

export default async function HomePage() {
  const session = await auth();

  if (session) {
    // Fetched here rather than in the client component: it comes from the
    // cached catalog, so it ships inside the first HTML with no round trip.
    const freshStock = await getFreshStock();
    // If logged in, show the AquaFresh Home Dashboard
    return <UserHome freshStock={freshStock} />;
  } else {
    // If NOT logged in, show the Fresh Catch Landing Page
    return <GuestLanding />;
  }
}
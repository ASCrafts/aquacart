import { auth } from "@/lib/auth";
import GuestLanding from "@/components/home/GuestLanding";
import UserHome from "@/components/home/UserHome";

export default async function HomePage() {
  const session = await auth();

  if (session) {
    // If logged in, show the AquaFresh Home Dashboard
    return <UserHome />;
  } else {
    // If NOT logged in, show the Fresh Catch Landing Page
    return <GuestLanding />;
  }
}
import { auth } from "@/lib/auth";
import GuestLanding, { type LandingCategory } from "@/components/home/GuestLanding";
import UserHome from "@/components/home/UserHome";
import { getFreshCatches, getListedProducts } from "@/lib/products";

/** Real categories from the catalog, so the home page never advertises a fish we don't sell. */
async function landingCategories(): Promise<LandingCategory[]> {
  const counts = new Map<string, number>();
  for (const product of await getListedProducts()) {
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export default async function HomePage() {
  const session = await auth();

  if (session) {
    // Fetched here rather than in the client component: it is a stock-aware
    // read (viewFor() against today's DayStock row), so it must never be
    // cached the way the catalog is — see the comment on getShopListing().
    const [freshStock, categories] = await Promise.all([getFreshCatches(), landingCategories()]);
    return <UserHome freshStock={freshStock} categories={categories} />;
  }

  return <GuestLanding categories={await landingCategories()} />;
}

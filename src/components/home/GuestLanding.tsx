import Link from 'next/link';
import Image from 'next/image';
import {
  Fish,
  FishSymbol,
  Shell,
  Truck,
  ShieldCheck,
  Ship,
  Anchor,
  Package,
  Headset,
  Leaf,
  ArrowRight,
  Waves,
  Clock,
  type LucideIcon,
} from 'lucide-react';

const trust = [
  { icon: Ship, title: 'Landed today', desc: 'Every kilo is from this morning’s catch' },
  { icon: Truck, title: 'Delivered today', desc: 'Order by 7:30 PM for same-day delivery' },
  { icon: ShieldCheck, title: 'Refund if short', desc: 'If the catch falls short, you are refunded' },
];

export interface LandingCategory {
  name: string;
  count: number;
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Fish,
  Prawns: FishSymbol,
  Crab: Waves,
  Squid: Shell,
};

const promises = [
  { icon: Leaf, title: 'No Preservatives', desc: 'Fresh, never frozen' },
  { icon: Anchor, title: 'Local boats', desc: 'Bought at the harbour' },
  { icon: Package, title: 'Hygienically Packed', desc: 'Iced and sealed' },
  { icon: Headset, title: 'Customer Support', desc: "We're here to help" },
];

export default function GuestLanding({ categories }: { categories: LandingCategory[] }) {
  return (
    <div className="flex flex-col w-full bg-aq-surface overflow-x-hidden">
      {/* ===== Hero ===== */}
      <section className="relative bg-aq-surface">
        <div className="flex flex-col-reverse lg:flex-row lg:items-center">
          {/* Copy */}
          <div className="w-full lg:w-1/2 px-6 md:px-12 lg:pl-16 xl:pl-24 py-10 lg:py-24">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-aq-primary-fixed text-aq-primary text-[11px] font-bold tracking-wide mb-5">
              <Fish className="w-3.5 h-3.5" />
              TODAY&apos;S CATCH, BY THE KILO
            </div>

            <h1 className="text-4xl md:text-6xl font-extrabold text-aq-primary leading-[1.05] tracking-tight mb-5">
              From Ocean to
              <br />
              Your Doorstep.{' '}
              <span className="italic font-serif text-aq-primary-container">Fresh.</span>
            </h1>

            <p className="text-aq-on-surface-variant text-base md:text-lg max-w-md mb-7 leading-relaxed">
              Fish that landed this morning, cut to the weight you want and delivered the same day.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/shop"
                id="cta-register"
                className="inline-flex h-12 items-center gap-2 px-7 rounded-full bg-aq-primary text-white font-bold shadow-aq-button hover:shadow-aq-hover transition-all duration-300 active:scale-[0.98]"
              >
                Browse today&apos;s catch
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/register"
                className="inline-flex h-12 items-center px-5 rounded-full border border-aq-outline-variant text-aq-on-surface font-semibold hover:bg-aq-surface-container transition-colors"
              >
                Create account
              </Link>
            </div>

            <p className="mt-6 flex items-center gap-2 text-sm text-aq-on-surface-variant">
              <Clock className="h-4 w-4 text-aq-primary" />
              Order by <span className="font-bold text-aq-on-surface">7:30 PM</span> for delivery today
            </p>
          </div>

          {/* Morphed picture */}
          <div className="relative w-full lg:w-1/2 h-[260px] md:h-[440px] lg:h-[640px]">
            <Image
              src="https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?q=80&w=1600&auto=format&fit=crop"
              alt="Fresh seafood on ice"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover animate-morph motion-reduce:animate-none"
              style={{ borderRadius: '58% 0 0 58% / 50% 0 0 50%' }}
            />
          </div>
        </div>
      </section>

      {/* ===== Trust bar ===== */}
      <section className="mx-4 md:mx-8">
        <div className="rounded-3xl bg-aq-gradient-primary shadow-aq-lg px-6 py-6 md:px-10 md:py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 divide-y md:divide-y-0 md:divide-x divide-white/15">
            {trust.map((t) => (
              <div key={t.title} className="flex items-center gap-4 px-1 md:px-5 pt-5 first:pt-0 md:pt-0">
                <div className="w-12 h-12 shrink-0 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-white">
                  <t.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-white font-bold mb-0.5">{t.title}</h3>
                  <p className="text-white/70 text-sm leading-snug">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Categories ===== */}
      {categories.length > 0 && (
        <section className="pt-12 pb-14 md:pb-20 px-4 md:px-8" id="categories">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6 md:mb-10 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold text-aq-on-surface tracking-tight">
                  Shop by category
                </h2>
                <p className="mt-1 text-sm text-aq-on-surface-variant">What the boats bring in</p>
              </div>
              <Link href="/shop" className="shrink-0 text-sm font-bold text-aq-primary hover:underline">
                See all
              </Link>
            </div>

            {/* Icon tiles, not product photos: a category tile that borrows the
                first product's picture shows whatever that product's photo
                happens to be, which is how "Fish" ended up as a scallop. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
              {categories.map((c) => {
                const Icon = CATEGORY_ICON[c.name] ?? Fish;
                return (
                  <Link
                    key={c.name}
                    href={`/shop?category=${encodeURIComponent(c.name)}`}
                    className="aq-card group flex items-center gap-3 p-4 md:flex-col md:items-start md:gap-4 md:p-6"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-aq-primary-fixed text-aq-primary transition-colors group-hover:bg-aq-primary group-hover:text-white md:h-14 md:w-14">
                      <Icon className="h-5 w-5 md:h-7 md:w-7" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm md:text-lg text-aq-on-surface">{c.name}</h3>
                      <p className="text-xs text-aq-on-surface-variant">
                        {c.count} {c.count === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===== Promise bar ===== */}
      <section className="bg-aq-surface-container-low border-y border-aq-outline-variant/40 py-8 px-4 md:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-5">
          {promises.map((p) => (
            <div key={p.title} className="flex items-center gap-3">
              <p.icon className="w-6 h-6 shrink-0 text-aq-primary" />
              <div>
                <h4 className="font-bold text-sm text-aq-on-surface">{p.title}</h4>
                <p className="text-xs text-aq-on-surface-variant">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA Banner ===== */}
      <section className="mx-4 md:mx-8 my-12 md:my-16">
        <div className="max-w-7xl mx-auto rounded-3xl bg-aq-gradient-primary p-7 md:p-14 text-center md:text-left md:flex md:items-center md:justify-between overflow-hidden relative">
          <div className="relative z-10 space-y-2 md:max-w-lg">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white">
              Ready for the freshest catch?
            </h2>
            <p className="text-white/75 text-sm md:text-base">
              Get told the moment your favourite fish lands.
            </p>
          </div>
          <Link
            href="/register"
            className="relative z-10 inline-flex items-center justify-center gap-2 mt-5 md:mt-0 h-12 px-8 rounded-full bg-white text-aq-primary font-bold text-sm shadow-lg transition-all duration-300 active:scale-[0.98]"
          >
            Create free account
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

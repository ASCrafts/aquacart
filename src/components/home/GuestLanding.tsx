import Link from 'next/link';
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
  Star,
  ArrowRight,
  Waves,
} from 'lucide-react';

const trust = [
  { icon: Ship, title: 'Sourced Daily', desc: 'From trusted local fishermen' },
  { icon: Truck, title: 'Fast Delivery', desc: 'Delivered fresh to your doorstep' },
  { icon: ShieldCheck, title: '100% Quality', desc: 'Premium quality seafood guaranteed' },
];

const categories = [
  {
    name: 'Fish',
    varieties: '20+ Varieties',
    icon: Fish,
    tint: 'bg-aq-primary-fixed text-aq-primary',
    img: 'https://images.unsplash.com/photo-1535140728325-a4d3707eee61?q=80&w=800&auto=format&fit=crop',
  },
  {
    name: 'Prawns',
    varieties: '15+ Varieties',
    icon: FishSymbol,
    tint: 'bg-emerald-50 text-aq-tertiary',
    img: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?q=80&w=800&auto=format&fit=crop',
  },
  {
    name: 'Crab',
    varieties: '10+ Varieties',
    icon: Waves,
    tint: 'bg-orange-50 text-orange-500',
    img: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?q=80&w=800&auto=format&fit=crop',
  },
  {
    name: 'Lobster',
    varieties: '5+ Varieties',
    icon: Anchor,
    tint: 'bg-red-50 text-red-500',
    img: 'https://images.unsplash.com/photo-1610963069162-32cc4dbd8be9?q=80&w=800&auto=format&fit=crop',
  },
  {
    name: 'Shellfish',
    varieties: '12+ Varieties',
    icon: Shell,
    tint: 'bg-purple-50 text-purple-500',
    img: 'https://images.unsplash.com/photo-1592483648224-61bf8287bc4c?q=80&w=800&auto=format&fit=crop',
  },
];

const promises = [
  { icon: Leaf, title: 'No Preservatives', desc: '100% Natural' },
  { icon: Anchor, title: 'Sustainable Fishing', desc: 'For a better tomorrow' },
  { icon: Package, title: 'Hygienically Packed', desc: 'Safe & Clean' },
  { icon: Headset, title: 'Customer Support', desc: "We're here to help" },
];

export default function GuestLanding() {
  return (
    <div className="flex flex-col w-full bg-aq-surface overflow-x-hidden">
      {/* ===== Hero ===== */}
      <section className="relative bg-aq-surface">
        <div className="flex flex-col-reverse lg:flex-row lg:items-center">
          {/* Copy */}
          <div className="w-full lg:w-1/2 px-6 md:px-12 lg:pl-16 xl:pl-24 py-12 lg:py-24">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-aq-primary-fixed text-aq-primary text-[11px] font-bold tracking-wide mb-6">
              <Fish className="w-3.5 h-3.5" />
              PREMIUM QUALITY SEAFOOD
            </div>

            <h1 className="text-4xl md:text-6xl font-extrabold text-aq-primary leading-[1.05] tracking-tight mb-6">
              From Ocean to
              <br />
              Your Doorstep.{' '}
              <span className="italic font-serif text-aq-primary-container">Fresh.</span>
            </h1>

            <p className="text-aq-on-surface-variant text-base md:text-lg max-w-md mb-8 leading-relaxed">
              Sourced daily from local fishermen and delivered fresh to your doorstep.
              Experience the ocean&apos;s finest, like never before.
            </p>

            <Link
              href="/register"
              id="cta-register"
              className="inline-flex items-center gap-2 h-13 px-8 py-3.5 rounded-full bg-aq-primary text-white font-bold shadow-aq-button hover:shadow-aq-hover transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              SHOP NOW
              <ArrowRight className="w-4 h-4" />
            </Link>

            <div className="mt-10 flex items-center gap-4">
              <div>
                <p className="text-sm text-aq-on-surface-variant mb-1">
                  Loved by 10,000+ customers
                </p>
                <div className="flex items-center gap-0.5 text-amber-400">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="w-4 h-4 fill-current" />
                  ))}
                  <span className="ml-2 text-sm font-bold text-aq-on-surface">4.8/5</span>
                </div>
              </div>
            </div>
          </div>

          {/* Morphed picture */}
          <div className="relative w-full lg:w-1/2 h-[320px] md:h-[440px] lg:h-[640px]">
            <img
              src="https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?q=80&w=1600&auto=format&fit=crop"
              alt="Fresh seafood on ice"
              className="absolute inset-0 w-full h-full object-cover animate-morph motion-reduce:animate-none"
              style={{ borderRadius: '58% 0 0 58% / 50% 0 0 50%' }}
            />
            <div className="absolute bottom-6 right-6 lg:bottom-10 lg:right-10 bg-white p-4 rounded-2xl shadow-aq-lg flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-aq-primary-fixed text-aq-primary flex items-center justify-center">
                <Ship className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-aq-on-surface">Daily Catch</p>
                <p className="text-xs font-medium text-aq-tertiary">100% Fresh Guarantee</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Trust bar ===== */}
      <section className="relative z-10 -mt-6 lg:-mt-10 mx-4 md:mx-8">
        <div className="mt-16 rounded-3xl bg-aq-gradient-primary shadow-aq-lg px-6 py-8 md:px-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-white/15">
            {trust.map((t) => (
              <div key={t.title} className="flex items-center gap-4 px-2 md:px-5 pt-6 first:pt-0 md:pt-0">
                <div className="w-14 h-14 shrink-0 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-white">
                  <t.icon className="w-6 h-6" />
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
      <section className="pt-8 pb-16 md:pt-8 md:pb-20 px-6 md:px-8" id="categories">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-extrabold text-aq-primary tracking-tight mb-2">
              Shop by Category
            </h2>
            <Waves className="w-5 h-5 mx-auto text-aq-primary/50 mb-3" />
            <p className="text-aq-on-surface-variant">Handpicked seafood, just for you</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {categories.map((c) => (
              <Link
                key={c.name}
                href="/register"
                className="aq-card group overflow-hidden p-0"
              >
                <div className="h-40 overflow-hidden bg-aq-surface-container">
                  <img
                    src={c.img}
                    alt={c.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-5 flex items-start gap-4">
                  <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${c.tint}`}>
                    <c.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-aq-on-surface mb-0.5">{c.name}</h3>
                    <p className="text-xs text-aq-on-surface-variant mb-3">{c.varieties}</p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-aq-primary">
                      SHOP NOW <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Promise bar ===== */}
      <section className="bg-aq-surface-container-low border-t border-aq-outline-variant/40 py-10 px-6 md:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 divide-y md:divide-y-0 md:divide-x divide-aq-outline-variant/40">
          {promises.map((p) => (
            <div key={p.title} className="flex items-center gap-4 px-4 pt-6 md:pt-0 first:pt-0">
              <p.icon className="w-7 h-7 shrink-0 text-aq-primary" />
              <div>
                <h4 className="font-bold text-sm text-aq-on-surface">{p.title}</h4>
                <p className="text-xs text-aq-on-surface-variant">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA Banner ===== */}
      <section className="mx-4 md:mx-8 my-16">
        <div className="max-w-7xl mx-auto rounded-3xl bg-aq-gradient-primary p-8 md:p-14 text-center md:text-left md:flex md:items-center md:justify-between overflow-hidden relative">
          <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/5" />
          <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-white/5" />

          <div className="relative z-10 space-y-3 md:max-w-lg">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white">
              Ready for the freshest catch?
            </h2>
            <p className="text-white/70 text-sm md:text-base">
              Join thousands of seafood lovers who trust AquaCart for premium, sustainable delivery.
            </p>
          </div>
          <Link
            href="/register"
            className="relative z-10 inline-flex items-center justify-center gap-2 mt-6 md:mt-0 h-12 px-8 rounded-full bg-white text-aq-primary font-bold text-sm shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          >
            Create Free Account
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
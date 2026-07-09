import Link from 'next/link';
import { Fish, Leaf, Truck, ArrowRight, Sparkles } from 'lucide-react';

const features = [
  {
    icon: Fish,
    title: 'Ocean Fresh',
    desc: 'From sea to your door in under 24 hours. Every catch handpicked for peak freshness.',
    color: 'bg-aq-primary-fixed text-aq-primary',
  },
  {
    icon: Leaf,
    title: 'Sustainably Sourced',
    desc: 'Supporting responsible fishing practices that protect our oceans for future generations.',
    color: 'bg-emerald-50 text-aq-tertiary',
  },
  {
    icon: Truck,
    title: 'Free Delivery',
    desc: 'On orders above ₹1000 — delivered same-day with temperature-controlled packaging.',
    color: 'bg-amber-50 text-amber-600',
  },
];

export default function GuestLanding() {
  return (
    <div className="relative flex flex-col min-h-screen w-full overflow-hidden bg-aq-surface">
      {/* ===== Hero Section ===== */}
      <section className="relative min-h-[90vh] md:min-h-[85vh] flex flex-col items-center justify-center overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1529230117798-3a4a96c94611?q=80&w=2560&auto=format&fit=crop")',
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(0,40,120,0.6)] via-[rgba(0,60,160,0.4)] to-[rgba(0,80,203,0.85)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center max-w-2xl mx-auto">
          {/* Headline (branding lives in the sticky GuestHeader above) */}
          <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15">
              <Sparkles className="w-3.5 h-3.5 text-aq-tertiary-fixed" />
              <span className="text-xs font-medium text-white/90">Premium Sustainable Seafood</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-[1.1] tracking-tight">
              The Freshest Catch,{' '}
              <span className="text-aq-tertiary-fixed">Delivered</span> to You.
            </h1>
            <p className="text-base md:text-lg text-white/80 max-w-md mx-auto leading-relaxed">
              Sustainable seafood sourced daily from local fishermen, delivered right to your doorstep.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
            <Link
              href="/register"
              className="flex-1 flex items-center justify-center gap-2 h-13 px-8 py-3.5 rounded-full bg-white text-aq-primary font-bold text-base shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
              id="cta-register"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="flex-1 flex items-center justify-center h-13 px-8 py-3.5 rounded-full border-2 border-white/30 text-white font-semibold text-base backdrop-blur-sm hover:bg-white/10 transition-all duration-300 active:scale-[0.98]"
              id="cta-login"
            >
              Sign In
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-pulse-soft">
          <div className="w-6 h-10 rounded-full border-2 border-white/30 flex items-start justify-center pt-2">
            <div className="w-1.5 h-3 rounded-full bg-white/60 animate-bounce" />
          </div>
        </div>
      </section>

      {/* ===== Why Choose Us ===== */}
      <section className="py-16 md:py-24 px-6 bg-aq-surface" id="why-choose">
        <div className="max-w-6xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-12 md:mb-16">
            <span className="aq-badge aq-badge-primary text-xs mb-3 inline-flex">WHY AQUACART</span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-aq-on-surface tracking-tight">
              The Premium Seafood Experience
            </h2>
            <p className="mt-3 text-aq-on-surface-variant max-w-lg mx-auto">
              We handle every step from ocean to plate so you can enjoy the finest seafood, effortlessly.
            </p>
          </div>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature, idx) => (
              <div
                key={feature.title}
                className="aq-card p-6 md:p-8 group cursor-default"
              >
                <div
                  className={`w-14 h-14 rounded-2xl ${feature.color} flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110`}
                >
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-aq-on-surface mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-aq-on-surface-variant leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA Banner ===== */}
      <section className="mx-4 md:mx-8 mb-16">
        <div className="max-w-6xl mx-auto rounded-3xl bg-aq-gradient-primary p-8 md:p-14 text-center md:text-left md:flex md:items-center md:justify-between overflow-hidden relative">
          {/* Decorative circles */}
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
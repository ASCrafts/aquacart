export default function ShopLoading() {
  return (
    <div className="bg-aq-surface min-h-screen">
      {/* Skeleton Hero Banner */}
      <section className="bg-aq-gradient-primary py-10 md:py-16 px-4 animate-pulse-soft">
        <div className="container text-center max-w-2xl mx-auto flex flex-col items-center">
          <div className="h-8 md:h-12 w-64 bg-white/20 rounded-full mb-3" />
          <div className="h-4 w-88 bg-white/10 rounded-full mb-6" />
          {/* Mock Search input */}
          <div className="h-12 w-full max-w-lg bg-white/15 rounded-full" />
        </div>
      </section>

      <div className="container py-6 md:py-10">
        {/* Category filter chips skeletons */}
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-4 mb-2">
          {['All', 'Fish', 'Prawns', 'Crab', 'Lobster', 'Oysters'].map((item, idx) => (
            <div
              key={idx}
              className="h-8 w-20 rounded-full bg-aq-surface-container animate-shimmer shrink-0"
            />
          ))}
        </div>

        {/* Products Grid Skeleton */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:gap-6">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="aq-card-static overflow-hidden flex flex-col h-full"
            >
              {/* Product Image placeholder */}
              <div className="relative aspect-square bg-aq-surface-container animate-shimmer w-full" />

              {/* Product Details placeholder */}
              <div className="p-3 sm:p-4 flex flex-col flex-1 gap-2.5">
                {/* Category badge and Rating */}
                <div className="flex justify-between items-center">
                  <div className="h-4 w-12 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-4 w-14 bg-aq-surface-container-high rounded animate-shimmer" />
                </div>

                {/* Title */}
                <div className="h-5 w-4/5 bg-aq-surface-on-variant/10 rounded animate-shimmer mt-1" />

                {/* Price */}
                <div className="h-6 w-1/3 bg-aq-surface-on-variant/20 rounded animate-shimmer mt-2" />

                {/* Button placeholder */}
                <div className="h-9 w-full bg-aq-surface-container-highest rounded-full animate-shimmer mt-auto pt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

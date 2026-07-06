export default function CartLoading() {
  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        {/* Header Skeleton */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-aq-surface-container animate-shimmer" />
          <div className="space-y-1.5">
            <div className="h-6 w-32 bg-aq-surface-container-highest rounded animate-shimmer" />
            <div className="h-3 w-48 bg-aq-surface-container-high rounded animate-shimmer" />
          </div>
        </div>

        {/* Cart Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          
          {/* Column 1: Items List Skeleton */}
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="aq-card-static p-4 flex gap-4 items-center animate-pulse-soft"
              >
                {/* Image Placeholder */}
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-aq-surface-container animate-shimmer flex-shrink-0" />

                {/* Info block */}
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-2/5 bg-aq-surface-container-highest rounded animate-shimmer" />
                  <div className="h-3.5 w-1/4 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-5 w-16 bg-aq-surface-container-highest rounded animate-shimmer" />
                </div>

                {/* Controls mock */}
                <div className="flex flex-col items-end justify-between h-20 sm:h-24">
                  <div className="w-8 h-8 rounded-full bg-aq-surface-container animate-shimmer" />
                  <div className="w-24 h-8 rounded-full bg-aq-surface-container animate-shimmer" />
                </div>
              </div>
            ))}
          </div>

          {/* Column 2: Order Summary card skeleton */}
          <div className="lg:col-span-1">
            <div className="aq-card-static p-6 space-y-5">
              <div className="h-5 w-1/3 bg-aq-surface-container-highest rounded animate-shimmer" />
              <div className="space-y-3.5 pt-2">
                <div className="flex justify-between">
                  <div className="h-4 w-16 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-4 w-12 bg-aq-surface-container-high rounded animate-shimmer" />
                </div>
                <div className="flex justify-between">
                  <div className="h-4 w-20 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-4 w-14 bg-aq-surface-container-high rounded animate-shimmer" />
                </div>
                <div className="border-t border-aq-outline-variant/15 pt-3 flex justify-between">
                  <div className="h-5 w-12 bg-aq-surface-container-highest rounded animate-shimmer" />
                  <div className="h-5 w-16 bg-aq-surface-container-highest rounded animate-shimmer" />
                </div>
              </div>

              {/* Promo code mock */}
              <div className="h-10 w-full bg-aq-surface-container rounded-lg animate-shimmer" />

              {/* Checkout Button */}
              <div className="h-12 w-full bg-aq-surface-container-highest rounded-full animate-shimmer" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

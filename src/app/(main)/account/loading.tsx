export default function AccountLoading() {
  return (
    <div className="bg-aq-surface min-h-screen">
      <div className="container py-6 md:py-10">
        
        {/* Header Skeleton */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-full bg-aq-surface-container animate-shimmer flex-shrink-0" />
          <div className="space-y-2">
            <div className="h-6 w-40 bg-aq-surface-container-highest rounded animate-shimmer" />
            <div className="h-4 w-60 bg-aq-surface-container-high rounded animate-shimmer" />
          </div>
        </div>

        {/* Account Layout Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          
          {/* Left Column: Sidebar / Profile Editor Mock */}
          <div className="lg:col-span-1 space-y-6">
            <div className="aq-card-static p-6 space-y-4">
              <div className="h-5 w-1/3 bg-aq-surface-container-highest rounded animate-shimmer pb-1 border-b border-aq-outline-variant/10" />
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <div className="h-3 w-12 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-10 w-full bg-aq-surface-container rounded-lg animate-shimmer" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-3 w-12 bg-aq-surface-container-high rounded animate-shimmer" />
                  <div className="h-10 w-full bg-aq-surface-container rounded-lg animate-shimmer" />
                </div>
              </div>
              <div className="h-10 w-24 bg-aq-surface-container-highest rounded-full animate-shimmer pt-2" />
            </div>
          </div>

          {/* Right Column: Address and Orders Skeletons */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Address Management Skeletons */}
            <div className="aq-card-static p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="h-5 w-1/4 bg-aq-surface-container-highest rounded animate-shimmer" />
                <div className="h-8 w-28 bg-aq-surface-container-highest rounded-full animate-shimmer" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {Array.from({ length: 2 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-aq-outline-variant/15 space-y-2.5 animate-pulse-soft"
                  >
                    <div className="flex justify-between items-center">
                      <div className="h-4.5 w-1/3 bg-aq-surface-container-highest rounded animate-shimmer" />
                      <div className="h-4 w-12 bg-aq-surface-container-high rounded animate-shimmer" />
                    </div>
                    <div className="space-y-1.5 pt-1">
                      <div className="h-3.5 w-4/5 bg-aq-surface-container-high rounded animate-shimmer" />
                      <div className="h-3.5 w-1/2 bg-aq-surface-container-high rounded animate-shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order History Listing Skeletons */}
            <div className="aq-card-static p-6 space-y-4">
              <div className="h-5 w-1/4 bg-aq-surface-container-highest rounded animate-shimmer" />
              
              <div className="space-y-4 pt-2">
                {Array.from({ length: 2 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-aq-outline-variant/15 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-pulse-soft"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-24 bg-aq-surface-container-highest rounded animate-shimmer" />
                        <div className="h-4.5 w-16 bg-aq-surface-container-high rounded animate-shimmer" />
                      </div>
                      <div className="h-3.5 w-40 bg-aq-surface-container-high rounded animate-shimmer" />
                    </div>
                    <div className="flex items-center gap-3 self-end md:self-center">
                      <div className="h-5 w-16 bg-aq-surface-container-highest rounded animate-shimmer" />
                      <div className="h-9 w-20 bg-aq-surface-container-highest rounded-full animate-shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

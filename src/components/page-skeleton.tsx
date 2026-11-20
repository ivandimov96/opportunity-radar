/**
 * The outline of a workspace page in grey blocks (title, a bar of controls, a
 * card of rows), shown while one of those pages loads.
 */
import { Skeleton } from "@/components/ui";

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-9 w-64 mb-6" />
      <Skeleton className="h-16 w-full mb-5 rounded-[var(--radius)]" />
      <div className="surface p-5 space-y-4">
        <Skeleton className="h-5 w-48" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-8 w-20 hidden sm:block" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** The outline of the dashboard: the greeting, what is waiting, and the card of five figures. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <Skeleton className="h-9 w-72 mb-2" />
      <Skeleton className="h-4 w-40 mb-6" />
      <div className="surface mb-5">
        <div className="px-5 py-3 border-b border-line">
          <Skeleton className="h-5 w-36" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-line last:border-b-0">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <Skeleton className="h-5 flex-1 max-w-xs" />
            <Skeleton className="h-10 w-28 ml-auto" />
          </div>
        ))}
      </div>
      <div className="surface mb-5">
        <div className="px-5 py-3 border-b border-line">
          <Skeleton className="h-5 w-44" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="px-5 py-4 space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="surface p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** The outline of the to-do list: the filters, then groups of rows. */
export function TodoSkeleton() {
  return (
    <div role="status" aria-label="Loading the to-do list">
      <Skeleton className="h-9 w-32 mb-6" />
      <div className="flex gap-2 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      {[0, 1].map((g) => (
        <div key={g} className="surface mb-4">
          <div className="px-5 py-3 border-b border-line">
            <Skeleton className="h-5 w-28" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-line last:border-b-0">
              <Skeleton className="h-4 w-16 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-8 w-20 hidden sm:block" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

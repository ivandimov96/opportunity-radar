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

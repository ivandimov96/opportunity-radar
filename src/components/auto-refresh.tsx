"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component tree while background work is active. */
export function AutoRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return active ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-accent">
      <span className="w-2 h-2 rounded-full bg-accent animate-pulse" /> Working… auto-refreshing
    </span>
  ) : null;
}

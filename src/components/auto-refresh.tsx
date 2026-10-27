"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component tree while background work is active. */
export function AutoRefresh({ active, intervalMs = 2500, label = "Working" }: { active: boolean; intervalMs?: number; label?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-accent-text bg-accent-soft rounded-full px-2.5 py-1">
      <span className="w-1.5 h-1.5 rounded-full bg-accent pulse" /> {label}… updates live
    </span>
  );
}

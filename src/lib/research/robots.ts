import robotsParser from "robots-parser";
import { RESEARCH_USER_AGENT, safeFetch } from "./fetcher";

type Robots = ReturnType<typeof robotsParser>;
const cache = new Map<string, Promise<Robots | null>>();

/** Fetch and cache robots.txt per origin. Missing/unreachable robots => allowed. */
export async function getRobots(origin: string): Promise<Robots | null> {
  if (!cache.has(origin)) {
    cache.set(
      origin,
      (async () => {
        try {
          const res = await safeFetch(`${origin}/robots.txt`, { accept: "text/plain,*/*;q=0.5", maxBytes: 200_000, timeoutMs: 8000 });
          if (res.status >= 400 || !res.body) return null;
          return robotsParser(`${origin}/robots.txt`, res.body);
        } catch {
          return null;
        }
      })(),
    );
  }
  return cache.get(origin)!;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  const robots = await getRobots(origin);
  if (!robots) return true;
  const allowed = robots.isAllowed(url, RESEARCH_USER_AGENT.split("/")[0]);
  return allowed !== false;
}

export function clearRobotsCache() {
  cache.clear();
}

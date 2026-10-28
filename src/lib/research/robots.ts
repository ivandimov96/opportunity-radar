/**
 * robots.txt check, run before any page is requested from Firecrawl. The policy
 * file itself is read directly (it is not page content), guarded like every
 * other URL, cached per origin for the process lifetime. Missing or unreachable
 * robots.txt means allowed.
 */
import robotsParser from "robots-parser";
import { RESEARCH_USER_AGENT, assertPublicUrl } from "./url-guard";

type Robots = ReturnType<typeof robotsParser>;
type RobotsFetch = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const cache = new Map<string, Promise<Robots | null>>();
let fetchImpl: RobotsFetch | null = null;

const defaultFetch: RobotsFetch = (url) => fetch(url, { headers: { "User-Agent": RESEARCH_USER_AGENT, Accept: "text/plain,*/*;q=0.5" }, signal: AbortSignal.timeout(8000), redirect: "follow" });

/** Test hook: replace the network call. */
export function _setRobotsFetch(fn: RobotsFetch | null) {
  fetchImpl = fn;
  cache.clear();
}

export async function getRobots(origin: string): Promise<Robots | null> {
  if (!cache.has(origin)) {
    cache.set(
      origin,
      (async () => {
        try {
          const url = `${origin}/robots.txt`;
          if (!fetchImpl) await assertPublicUrl(url); // the real network path is guarded; an injected transport is not the network
          const res = await (fetchImpl ?? defaultFetch)(url);
          if (!res.ok) return null;
          const text = (await res.text()).slice(0, 200_000);
          return text.trim() ? robotsParser(url, text) : null;
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

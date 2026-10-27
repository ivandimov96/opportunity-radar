/**
 * SSRF-guarded HTTP fetcher for untrusted website URLs.
 *  - http/https only, default ports only
 *  - every hostname (including each redirect hop) is resolved and must not be
 *    private, loopback, link-local, multicast, or a cloud metadata address
 *  - the connection is pinned to the validated IP (no DNS rebinding)
 *  - bounded response size, timeout, redirect count, and HTML/text only
 */
import dns from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { getConfig } from "@/lib/config";

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export const RESEARCH_USER_AGENT = "OpportunityRadarBot/0.1 (+https://github.com/opportunity-radar; respectful research crawler)";

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const PRIVATE_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const;

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local, ULA
    if (v.startsWith("ff")) return true; // multicast
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (v.startsWith("64:ff9b:")) return true; // NAT64 - be conservative
    return false;
  }
  return true;
}

export function validateUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchBlockedError(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchBlockedError(`Blocked protocol: ${u.protocol}`);
  if (u.username || u.password) throw new FetchBlockedError("Credentials in URL are not allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchBlockedError(`Blocked port: ${u.port}`);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new FetchBlockedError(`Blocked host: ${host}`);
  if (net.isIP(host.replace(/^\[|\]$/g, "")) && isPrivateIp(host.replace(/^\[|\]$/g, ""))) throw new FetchBlockedError(`Blocked private IP: ${host}`);
  return u;
}

/** Resolve and validate; returns the pinned address. Exported for tests. */
export async function resolvePublicAddress(hostname: string, lookup = dns.lookup): Promise<{ address: string; family: 4 | 6 }> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new FetchBlockedError(`Blocked private IP: ${bare}`);
    return { address: bare, family: net.isIPv6(bare) ? 6 : 4 };
  }
  let results: { address: string; family: number }[];
  try {
    results = await lookup(bare, { all: true });
  } catch (err) {
    throw new FetchBlockedError(`DNS lookup failed for ${bare}: ${(err as Error).message}`);
  }
  if (!results.length) throw new FetchBlockedError(`DNS returned no addresses for ${bare}`);
  for (const r of results) if (isPrivateIp(r.address)) throw new FetchBlockedError(`Host ${bare} resolves to a blocked address (${r.address})`);
  const pick = results.find((r) => r.family === 4) ?? results[0];
  return { address: pick.address, family: pick.family === 6 ? 6 : 4 };
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  bytes: number;
  truncated: boolean;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  signal?: AbortSignal;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<FetchResult> {
  const cfg = getConfig();
  const timeoutMs = opts.timeoutMs ?? cfg.RESEARCH_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? cfg.RESEARCH_PAGE_BYTES_LIMIT;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = validateUrlShape(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const pinned = await resolvePublicAddress(current.hostname);
    const agent = new Agent({
      connect: {
        timeout: timeoutMs,
        lookup: (_host, _o, cb) => cb(null, [{ address: pinned.address, family: pinned.family }]),
      },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort);
    try {
      const res = await undiciFetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        dispatcher: agent,
        signal: controller.signal,
        headers: {
          "User-Agent": RESEARCH_USER_AGENT,
          Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new FetchBlockedError("Redirect without location");
        current = validateUrlShape(new URL(loc, current).toString());
        continue;
      }
      const contentType = res.headers.get("content-type");
      if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
        return { url: rawUrl, finalUrl: current.toString(), status: res.status, contentType, body: "", bytes: 0, truncated: false };
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let truncated = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            chunks.push(value.subarray(0, Math.max(0, maxBytes - (bytes - value.byteLength))));
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return { url: rawUrl, finalUrl: current.toString(), status: res.status, contentType, body, bytes: Math.min(bytes, maxBytes), truncated };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
      agent.close().catch(() => {});
    }
  }
  throw new FetchBlockedError(`Too many redirects (> ${maxRedirects})`);
}

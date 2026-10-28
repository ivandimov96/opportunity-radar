/**
 * URL guard for untrusted website addresses. Pages are fetched by Firecrawl,
 * but every URL still passes through here before it leaves the application
 * (scrape and map requests, robots.txt, website-finder candidates):
 *  - http/https only, default ports only, no credentials in the URL
 *  - the hostname must resolve to public addresses only (no private, loopback,
 *    link-local, multicast or cloud-metadata ranges)
 */
import dns from "node:dns/promises";
import net from "node:net";

export class UrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlBlockedError";
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
    throw new UrlBlockedError(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlBlockedError(`Blocked protocol: ${u.protocol}`);
  if (u.username || u.password) throw new UrlBlockedError("Credentials in URL are not allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UrlBlockedError(`Blocked port: ${u.port}`);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new UrlBlockedError(`Blocked host: ${host}`);
  if (net.isIP(host.replace(/^\[|\]$/g, "")) && isPrivateIp(host.replace(/^\[|\]$/g, ""))) throw new UrlBlockedError(`Blocked private IP: ${host}`);
  return u;
}

/** Resolve and validate; returns a public address. Exported for tests. */
export async function resolvePublicAddress(hostname: string, lookup = dns.lookup): Promise<{ address: string; family: 4 | 6 }> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new UrlBlockedError(`Blocked private IP: ${bare}`);
    return { address: bare, family: net.isIPv6(bare) ? 6 : 4 };
  }
  let results: { address: string; family: number }[];
  try {
    results = await lookup(bare, { all: true });
  } catch (err) {
    throw new UrlBlockedError(`DNS lookup failed for ${bare}: ${(err as Error).message}`);
  }
  if (!results.length) throw new UrlBlockedError(`DNS returned no addresses for ${bare}`);
  for (const r of results) if (isPrivateIp(r.address)) throw new UrlBlockedError(`Host ${bare} resolves to a blocked address (${r.address})`);
  const pick = results.find((r) => r.family === 4) ?? results[0];
  return { address: pick.address, family: pick.family === 6 ? 6 : 4 };
}

/** Shape and DNS checks in one call. Throws UrlBlockedError. */
export async function assertPublicUrl(raw: string, lookup = dns.lookup): Promise<URL> {
  const u = validateUrlShape(raw);
  await resolvePublicAddress(u.hostname, lookup);
  return u;
}

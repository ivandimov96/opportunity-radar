import { describe, expect, it } from "vitest";
import { UrlBlockedError, isPrivateIp, resolvePublicAddress, validateUrlShape } from "@/lib/research/url-guard";

describe("isPrivateIp", () => {
  it("blocks private, loopback, link-local and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.1.1", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("validateUrlShape", () => {
  it("rejects dangerous shapes", () => {
    for (const u of ["ftp://example.com", "file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://example.com:8080/", "http://user:pw@example.com/", "http://intranet/", "http://box.local/"]) {
      expect(() => validateUrlShape(u), u).toThrow(UrlBlockedError);
    }
  });
  it("accepts ordinary websites", () => {
    expect(validateUrlShape("https://www.example.com/about").hostname).toBe("www.example.com");
  });
});

describe("resolvePublicAddress", () => {
  it("rejects hosts resolving to private addresses (DNS rebinding guard)", async () => {
    const lookup = (async () => [{ address: "10.0.0.5", family: 4 }]) as never;
    await expect(resolvePublicAddress("evil.example", lookup)).rejects.toThrow(/blocked address/);
  });
  it("rejects when any address is private", async () => {
    const lookup = (async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]) as never;
    await expect(resolvePublicAddress("mixed.example", lookup)).rejects.toThrow(UrlBlockedError);
  });
  it("returns a pinned public address", async () => {
    const lookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;
    await expect(resolvePublicAddress("ok.example", lookup)).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });
});

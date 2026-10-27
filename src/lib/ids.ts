import { createHash, randomUUID } from "node:crypto";
export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

/** Deterministic UUID-shaped id derived from a label. Used for demo/synthetic records so links stay stable across re-seeds and server instances. */
export function stableId(label: string): string {
  const h = createHash("sha1").update(`opportunity-radar:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

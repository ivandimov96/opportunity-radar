/**
 * Grid cells for source caching. Every fetched place is stored with the cell it
 * falls in; a search first finds the cells its area touches, fetches only the
 * cells that are missing or stale from the source (one bounded query for their
 * union), and then answers from the local table. Adjacent and repeated
 * searches therefore cost no remote reads. Cells are 0.2° (~22 km N–S).
 */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const CELL_DEG = 0.2;

const idx = (v: number) => Math.floor(Math.round(v / CELL_DEG * 1e6) / 1e6);

export function cellIdFor(lat: number, lon: number): string {
  return `${idx(lat)}:${idx(lon)}`;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function cellBBox(id: string): BBox {
  const [a, b] = id.split(":").map(Number);
  return { south: r6(a * CELL_DEG), north: r6((a + 1) * CELL_DEG), west: r6(b * CELL_DEG), east: r6((b + 1) * CELL_DEG) };
}

/** Ids of every cell intersecting the bbox (inclusive edges). */
export function cellsForBBox(bbox: BBox): string[] {
  const out: string[] = [];
  const latMax = idx(bbox.north - 1e-9);
  const lonMax = idx(bbox.east - 1e-9);
  for (let a = idx(bbox.south); a <= latMax; a++) for (let b = idx(bbox.west); b <= lonMax; b++) out.push(`${a}:${b}`);
  return out;
}

export function unionBBox(ids: string[]): BBox {
  const boxes = ids.map(cellBBox);
  return { south: Math.min(...boxes.map((b) => b.south)), west: Math.min(...boxes.map((b) => b.west)), north: Math.max(...boxes.map((b) => b.north)), east: Math.max(...boxes.map((b) => b.east)) };
}

/** A bbox around a center: 1° latitude ≈ 111 km; longitude shrinks with latitude. */
export function bboxAround(lat: number, lon: number, radiusKm: number): BBox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function bboxSpanKm(b: BBox): { nsKm: number; ewKm: number } {
  const midLat = (b.south + b.north) / 2;
  return { nsKm: (b.north - b.south) * 111, ewKm: (b.east - b.west) * 111 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)) };
}

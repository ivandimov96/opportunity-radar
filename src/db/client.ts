/**
 * Database access via libSQL (SQLite-compatible). Works against a local file
 * in development (`file:./data/radar.db`) and a hosted Turso database in the
 * cloud (`libsql://...` + auth token). Migrations run once per process before
 * the first query. All queries are async.
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { getConfig } from "@/lib/config";

export type Db = LibSQLDatabase<typeof schema>;

type Holder = { client?: Client; db?: Db; ready?: Promise<Db>; key?: string };
const g = globalThis as unknown as { __radarDb?: Holder };
if (!g.__radarDb) g.__radarDb = {};

export function databaseUrl(): { url: string; authToken?: string; local: boolean } {
  const cfg = getConfig();
  if (cfg.TURSO_DATABASE_URL) return { url: cfg.TURSO_DATABASE_URL, authToken: cfg.TURSO_AUTH_TOKEN, local: false };
  const p = cfg.DATABASE_PATH;
  if (p === ":memory:") return { url: ":memory:", local: true };
  return { url: `file:${path.resolve(p)}`, local: true };
}

function migrationsFolder() {
  // The app always runs from the repository root (dev, start, tests, worker, serverless bundle).
  return path.join(process.cwd(), "drizzle");
}

/** Serverless without a hosted database: start every instance from the bundled snapshot, when there is one. */
function seedFromSnapshot(filePath: string) {
  const cfg = getConfig();
  if (!cfg.serverless || cfg.TURSO_DATABASE_URL || fs.existsSync(filePath)) return;
  const snapshot = path.resolve(/*turbopackIgnore: true*/ process.cwd(), cfg.DATABASE_SNAPSHOT);
  if (!fs.existsSync(snapshot)) return;
  fs.copyFileSync(snapshot, filePath);
  console.log(`[db] started from the bundled snapshot ${cfg.DATABASE_SNAPSHOT}`);
}

async function open(target: { url: string; authToken?: string; local: boolean }): Promise<Db> {
  if (target.local && target.url.startsWith("file:")) {
    const filePath = target.url.slice(5);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    seedFromSnapshot(filePath);
  }
  // Local files use ONE connection per process. The driver's busy wait is synchronous (it blocks
  // the event loop), so two pooled connections contending for SQLite's single write lock inside one
  // process can starve each other (observed: a job-claim transaction held open for the whole busy
  // timeout while a handler's write spun). With one connection every statement is queued
  // asynchronously by the pool instead. Consequence: no multi-statement transactions anywhere
  // (a statement issued while a transaction holds the connection is rejected); atomic multi-row
  // writes use `db.batch`, which runs its statements back to back on the connection.
  const client = createClient({ url: target.url, authToken: target.authToken, intMode: "number", ...(target.local ? { concurrency: 1 } : {}) });
  if (target.local) await client.execute("PRAGMA journal_mode = WAL").catch(() => {});
  await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  const holder = g.__radarDb!;
  holder.client = client;
  holder.db = db;
  return db;
}

/** Returns the migrated database handle (memoized per process). */
export function getDb(): Promise<Db> {
  const holder = g.__radarDb!;
  const target = databaseUrl();
  const key = `${target.url}|${target.authToken ? "token" : ""}`;
  if (holder.ready && holder.key === key) return holder.ready;
  holder.client?.close();
  holder.key = key;
  holder.db = undefined;
  holder.ready = open(target);
  return holder.ready;
}

/** Test helper: open a fresh database (in-memory by default). */
export function openDatabase(filePath?: string): Promise<Db> {
  if (filePath) process.env.DATABASE_PATH = filePath;
  const holder = g.__radarDb!;
  holder.client?.close();
  holder.ready = undefined;
  holder.key = undefined;
  return getDb();
}

export function closeDatabase() {
  const holder = g.__radarDb!;
  holder.client?.close();
  holder.client = undefined;
  holder.db = undefined;
  holder.ready = undefined;
  holder.key = undefined;
}

export { schema };

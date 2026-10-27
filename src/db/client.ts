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

async function open(target: { url: string; authToken?: string; local: boolean }): Promise<Db> {
  if (target.local && target.url.startsWith("file:")) fs.mkdirSync(path.dirname(target.url.slice(5)), { recursive: true });
  const client = createClient({ url: target.url, authToken: target.authToken, intMode: "number" });
  if (target.local) {
    await client.execute("PRAGMA journal_mode = WAL").catch(() => {});
    await client.execute("PRAGMA busy_timeout = 5000").catch(() => {});
  }
  await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  const holder = g.__radarDb!;
  holder.client = client;
  holder.db = db;
  return db;
}

/** Ephemeral serverless storage: keep the deployment useful on every cold start. */
async function needsDemoSeed(client: Client) {
  const cfg = getConfig();
  if (!cfg.serverless || cfg.TURSO_DATABASE_URL) return false;
  const n = (await client.execute("select count(*) as n from businesses")).rows[0]?.n as number;
  return !n;
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
  const base = open(target);
  // Seeding runs after `base` resolves and must see a resolved handle itself
  // (seedDemo and its helpers call getDb), so `ready` is swapped back to `base`
  // before the seed starts. Callers arriving mid-seed simply get the empty DB.
  holder.ready = base.then(async (db) => {
    if (holder.client && (await needsDemoSeed(holder.client))) {
      holder.ready = base;
      await import("./seed-demo")
        .then((m) => m.seedDemo())
        .catch((err) => console.warn("[db] demo seed failed", err));
    }
    return db;
  });
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

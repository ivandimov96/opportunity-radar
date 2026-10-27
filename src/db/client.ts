import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { getConfig } from "@/lib/config";

export type Db = BetterSQLite3Database<typeof schema>;

type Holder = { db?: Db; sqlite?: Database.Database; path?: string };
const g = globalThis as unknown as { __radarDb?: Holder };
if (!g.__radarDb) g.__radarDb = {};

function migrationsFolder() {
  // The app always runs from the repository root (dev, start, tests, worker).
  return path.join(process.cwd(), "drizzle");
}

export function openDatabase(filePath?: string): Db {
  const target = filePath ?? getConfig().DATABASE_PATH;
  const holder = g.__radarDb!;
  if (holder.db && holder.path === target) return holder.db;
  if (holder.sqlite) holder.sqlite.close();
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  const sqlite = new Database(target);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  holder.db = db;
  holder.sqlite = sqlite;
  holder.path = target;
  if (getConfig().serverless && target !== ":memory:") {
    const empty = (sqlite.prepare("select count(*) as n from businesses").get() as { n: number }).n === 0;
    if (empty) {
      // Ephemeral storage: make the deployment useful on every cold start.
      // Lazy import avoids a circular dependency at module load.
      void import("./seed-demo").then((m) => m.seedDemo()).catch((err) => console.warn("[db] demo seed failed", err));
    }
  }
  return db;
}

export function getDb(): Db {
  return openDatabase();
}

export function closeDatabase() {
  const holder = g.__radarDb!;
  holder.sqlite?.close();
  holder.db = undefined;
  holder.sqlite = undefined;
  holder.path = undefined;
}

export { schema };

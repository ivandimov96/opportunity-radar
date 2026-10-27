import { closeDatabase, openDatabase } from "./client";

await openDatabase();
console.log("Database migrated.");
closeDatabase();

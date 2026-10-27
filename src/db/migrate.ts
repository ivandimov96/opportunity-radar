import { openDatabase, closeDatabase } from "./client";

const db = openDatabase();
void db;
console.log("Database migrated.");
closeDatabase();

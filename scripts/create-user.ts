/**
 * Creates an account from the command line (the first one, or an owner, cannot
 * be made through the sign-up page of a workspace that already has an owner).
 *
 *   pnpm exec tsx --env-file=.env.development.local scripts/create-user.ts <email> <password> [name] [owner|member]
 *
 * The password is hashed before it is stored and is never printed.
 */
import { closeDatabase } from "@/db/client";
import { createUser } from "@/lib/auth";

const [email, password, name = "", role = "owner"] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: create-user.ts <email> <password> [name] [owner|member]");
  process.exit(1);
}
const res = await createUser({ email, password, name, role: role === "member" ? "member" : "owner" });
console.log(res.ok ? `Created ${res.user.role} account ${res.user.id}.` : `Not created: ${res.error}`);
closeDatabase();
process.exit(res.ok ? 0 : 1);

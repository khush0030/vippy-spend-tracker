#!/usr/bin/env node
/*
 * Generate SQL to create a credentials-login user in Supabase.
 *
 * Usage:
 *   node scripts/generate-user-sql.js <email> <password> [--name "Full Name"] [--claim-all]
 *
 * --claim-all  Also generates an UPDATE statement that remaps every existing
 *              transaction row to this new user id. Only use this if you are
 *              the sole user of the app.
 *
 * The script prints SQL to stdout. Copy it into the Supabase SQL Editor and run.
 */

const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = args.filter((a) => a.startsWith("--"));

const [email, password] = positional;
const nameFlagIdx = args.indexOf("--name");
const name = nameFlagIdx >= 0 ? args[nameFlagIdx + 1] : null;
const claimAll = flags.includes("--claim-all");

if (!email || !password) {
  console.error("Usage: node scripts/generate-user-sql.js <email> <password> [--name \"Full Name\"] [--claim-all]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const id = randomUUID();
const hash = bcrypt.hashSync(password, 10);
const esc = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

const lines = [
  "-- Run these statements in the Supabase SQL editor.",
  "-- 1. Ensure schema is ready",
  "alter table users add column if not exists password_hash text;",
  "create unique index if not exists users_email_key on users (email);",
  "",
  "-- 2. Create the credentials user",
  `insert into users (id, email, name, password_hash, provider, last_login)`,
  `values (${esc(id)}, ${esc(email.toLowerCase())}, ${esc(name)}, ${esc(hash)}, 'credentials', now())`,
  `on conflict (email) do update set`,
  `  password_hash = excluded.password_hash,`,
  `  name = coalesce(excluded.name, users.name),`,
  `  provider = 'credentials',`,
  `  last_login = now();`,
  "",
];

if (claimAll) {
  lines.push(
    "-- 3. Reassign every existing transaction to this user (single-user mode)",
    `update transactions set user_id = ${esc(id)};`,
    ""
  );
}

lines.push(
  "-- Verify:",
  `select id, email, provider, last_login from users where email = ${esc(email.toLowerCase())};`,
  `select count(*) as tx_count from transactions where user_id = ${esc(id)};`
);

console.log(lines.join("\n"));
console.error(`\nGenerated user id: ${id}`);
console.error(`After running this SQL, sign in at /login with ${email}`);

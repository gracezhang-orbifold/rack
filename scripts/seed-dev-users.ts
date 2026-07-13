// Creates admin@rack.local / user@rack.local (password123). Local dev only.
import { pool, query } from "../api/src/db.js";
import { hashPassword } from "../api/src/auth.js";

const hash = await hashPassword("password123");
await query(
  `insert into profiles (email, full_name, role, password_hash) values
   ('admin@rack.local', 'Rack Admin', 'admin', $1),
   ('user@rack.local', 'Rack User', 'user', $1)
   on conflict (email) do nothing`, [hash]);
await pool.end();
console.log("dev users ready");

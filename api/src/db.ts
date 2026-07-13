import pg from "pg";
import { env } from "./env.js";
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const query = (text: string, params?: unknown[]) => pool.query(text, params);

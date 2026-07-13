import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "./db.js";

export interface AuthedUser {
  id: string; email: string; role: "user" | "admin"; full_name: string | null;
}
declare module "fastify" {
  interface FastifyRequest { user?: AuthedUser }
}

const SESSION_DAYS = 30;
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(reply: FastifyReply, userId: string) {
  const { rows } = await query(
    `insert into sessions (user_id, expires_at)
     values ($1, now() + interval '${SESSION_DAYS} days') returning id`, [userId]);
  reply.setCookie("rack_session", rows[0].id, {
    path: "/", httpOnly: true, sameSite: "lax", signed: true,
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const sid = readSessionId(req);
  if (sid) await query(`delete from sessions where id = $1`, [sid]);
  reply.clearCookie("rack_session", { path: "/" });
}

function readSessionId(req: FastifyRequest): string | null {
  const raw = req.cookies["rack_session"];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const sid = readSessionId(req);
  if (sid) {
    const { rows } = await query(
      `select p.id, p.email, p.role, p.full_name from sessions s
       join profiles p on p.id = s.user_id
       where s.id = $1 and s.expires_at > now()`, [sid]);
    if (rows[0]) { req.user = rows[0]; return; }
  }
  reply.code(401).send({ error: "not authenticated" });
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.user!.role !== "admin") reply.code(403).send({ error: "admin only" });
}

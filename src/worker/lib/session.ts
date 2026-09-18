/**
 * Who is making this request, and what they are allowed to do.
 *
 * Under Supabase there was no answer to either question. The browser held a
 * JSON blob in localStorage saying who it was, the anon key let it write any
 * row in any table, and every `authorId` / `teacherId` in a payload was taken
 * at face value — so a student could edit another class's wall, or post as
 * their teacher, by editing one value in devtools.
 *
 * Now: sign-in proves an identity to the Worker, the Worker issues an opaque
 * session id in an HttpOnly cookie, and every write is checked here against the
 * row it touches. The client never names an author.
 */

import type { Context } from "hono";
import { db, storage } from "../platform";

export const SESSION_COOKIE = "wallama_session";
const SESSION_DAYS = 30;

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export class HttpError extends Error {
  /**
   * `detail` is for the client to show or log alongside the message — the
   * upstream status of a failed AI call, say. Never put anything in it that
   * the message was kept generic to avoid leaking.
   */
  constructor(public status: number, message: string, public detail?: Record<string, unknown>) {
    super(message);
  }
}

export interface AppUser {
  id: string;
  google_sub: string | null;
  email: string | null;
  name: string;
  avatar: string | null;
  role: "teacher" | "student";
  is_guest: number;
}

export interface WallRow {
  id: string;
  name: string;
  type: string;
  description: string;
  join_code: string;
  teacher_id: string;
  background: string;
  snap_to_grid: number;
  is_anonymous: number;
  is_frozen: number;
  privacy_type: string;
  icon: string;
  require_login_to_post: number;
  rev: number;
  created_at: string;
  updated_at: string;
}

/** Route params are typed as possibly-undefined; every caller here requires one. */
export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, `Missing ${name} parameter`);
  return value;
}

/* ---------- the session cookie ---------- */

function cookieValue(c: Context, name: string): string | null {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function writeCookie(c: Context, value: string, maxAgeSeconds: number) {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`,
    { append: true },
  );
}

const randomToken = (bytes = 32) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function startSession(c: Context, userId: string): Promise<void> {
  const id = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await db
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now(), expires)
    .run();
  writeCookie(c, id, SESSION_DAYS * 86_400);
}

export async function endSession(c: Context): Promise<void> {
  const id = cookieValue(c, SESSION_COOKIE);
  if (id) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
  writeCookie(c, "", 0);
}

/* ---------- who is asking ---------- */

export async function currentUser(c: Context): Promise<AppUser | null> {
  const id = cookieValue(c, SESSION_COOKIE);
  if (!id) return null;

  const session = await db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE id = ?`)
    .bind(id)
    .first<{ user_id: string; expires_at: string }>();
  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return null;
  }

  return await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(session.user_id).first<AppUser>();
}

export async function requireUser(c: Context): Promise<AppUser> {
  const user = await currentUser(c);
  if (!user) throw new HttpError(401, "You're not signed in.");
  return user;
}

export async function requireTeacher(c: Context): Promise<AppUser> {
  const user = await requireUser(c);
  if (user.role !== "teacher" || user.is_guest) {
    throw new HttpError(403, "Only a signed-in teacher can do that.");
  }
  return user;
}

/* ---------- what they may do with a wall ---------- */

export async function wallById(id: string): Promise<WallRow | null> {
  return await db.prepare(`SELECT * FROM walls WHERE id = ?`).bind(id).first<WallRow>();
}

export async function wallByCode(code: string): Promise<WallRow | null> {
  return await db
    .prepare(`SELECT * FROM walls WHERE join_code = ?`)
    .bind(code.toUpperCase().trim())
    .first<WallRow>();
}

const domainOf = (email: string | null) => (email ?? "").split("@")[1]?.toLowerCase() ?? "";

async function isMember(wallId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM wall_members WHERE wall_id = ? AND user_id = ?`)
    .bind(wallId, userId)
    .first<{ ok: number }>();
  return !!row;
}

/**
 * May this person see this wall at all?
 *
 * `public` and `link` walls are open — a link is the whole access control, which
 * is what makes a join code work for a class that has not signed in. `private`
 * is the owner and people already on it; `domain` additionally lets anyone from
 * the owner's email domain in, which is how a school shares a wall internally.
 */
export async function canReadWall(wall: WallRow, user: AppUser | null): Promise<boolean> {
  if (wall.privacy_type === "public" || wall.privacy_type === "link") return true;
  if (!user) return false;
  if (wall.teacher_id === user.id) return true;
  if (await isMember(wall.id, user.id)) return true;

  if (wall.privacy_type === "domain") {
    const owner = await db
      .prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(wall.teacher_id)
      .first<{ email: string | null }>();
    const ownerDomain = domainOf(owner?.email ?? null);
    return !!ownerDomain && domainOf(user.email) === ownerDomain;
  }
  return false;
}

export async function requireReadableWall(c: Context, wallId: string): Promise<{ wall: WallRow; user: AppUser | null }> {
  const wall = await wallById(wallId);
  if (!wall) throw new HttpError(404, "That wall doesn't exist.");
  const user = await currentUser(c);
  if (!(await canReadWall(wall, user))) throw new HttpError(403, "You don't have access to that wall.");
  return { wall, user };
}

/** Only the teacher who created a wall may change or delete it. */
export async function requireWallOwner(c: Context, wallId: string): Promise<{ wall: WallRow; user: AppUser }> {
  const user = await requireUser(c);
  const wall = await wallById(wallId);
  if (!wall) throw new HttpError(404, "That wall doesn't exist.");
  if (wall.teacher_id !== user.id) throw new HttpError(403, "That's not your wall.");
  return { wall, user };
}

/**
 * May this person add to, move, or edit things on this wall?
 *
 * Frozen is the teacher's "pencils down", so it stops everyone but them. The
 * `requireLoginToPost` switch is the one the wall settings offer, and it is
 * enforced here rather than by hiding a button.
 */
export async function requirePoster(c: Context, wall: WallRow): Promise<AppUser> {
  const user = await requireUser(c);
  if (!(await canReadWall(wall, user))) throw new HttpError(403, "You don't have access to that wall.");
  const isOwner = wall.teacher_id === user.id;
  if (wall.is_frozen && !isOwner) throw new HttpError(403, "This wall is frozen.");
  if (wall.require_login_to_post && user.is_guest && !isOwner) {
    throw new HttpError(403, "You have to sign in to post on this wall.");
  }
  return user;
}

/** Record that someone has opened a wall, so it shows up on their dashboard. */
export async function joinWall(wallId: string, userId: string, role: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wall_members (wall_id, user_id, role, last_accessed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (wall_id, user_id) DO UPDATE SET last_accessed_at = excluded.last_accessed_at`,
    )
    .bind(wallId, userId, role, now())
    .run();
}

/**
 * Note that something about this wall changed.
 *
 * `rev` is the wall's ETag. Bumping it on every write — to the wall or to any
 * post on it — is what lets a polling client be told "nothing since you last
 * asked" in a 304 with no body, instead of re-downloading every post three
 * times a second.
 */
export async function bumpWallRev(wallId: string): Promise<void> {
  await db.prepare(`UPDATE walls SET rev = rev + 1, updated_at = ? WHERE id = ?`).bind(now(), wallId).run();
}

/** Remove a wall and everything that belongs to it, including its media. */
export async function deleteWallCompletely(wallId: string): Promise<void> {
  // R2 first: a failure here leaves rows pointing at objects that still exist,
  // which is recoverable. The other order leaves objects nothing points at.
  await storage.deletePrefix(`walls/${wallId}/`);
  await db.batch([
    db.prepare(`DELETE FROM media WHERE wall_id = ?`).bind(wallId),
    db.prepare(`DELETE FROM posts WHERE wall_id = ?`).bind(wallId),
    db.prepare(`DELETE FROM wall_members WHERE wall_id = ?`).bind(wallId),
    db.prepare(`DELETE FROM walls WHERE id = ?`).bind(wallId),
  ]);
}

/** Wrap a handler so thrown HttpErrors become clean JSON instead of a 500. */
export function handler(fn: (c: Context) => Promise<Response>) {
  return async (c: Context) => {
    try {
      return await fn(c);
    } catch (err: any) {
      if (err instanceof HttpError) {
        return c.json({ error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.status as any);
      }
      console.error("Unhandled error:", err?.stack || err);
      return c.json({ error: err?.message ?? "Server error" }, 500);
    }
  };
}

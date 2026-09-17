/**
 * Walls: listing, creating, reading, changing, deleting.
 *
 * The read path is the one worth reading carefully. A wall is polled every few
 * seconds by every person looking at it, and under Supabase each of those polls
 * re-sent the entire wall — every post, including the base64 image data that
 * used to live in the row. `rev` turns the common case, where nothing has
 * happened since the last poll, into a 304 with no body at all.
 */

import { app, db } from "../platform";
import {
  HttpError,
  handler,
  currentUser,
  requireUser,
  requireTeacher,
  requireWallOwner,
  requireReadableWall,
  canReadWall,
  wallByCode,
  joinWall,
  deleteWallCompletely,
  now,
  uid,
  param,
  type WallRow,
} from "../lib/session";
import { wallShape, type PostRow } from "../lib/shape";

const WALL_TYPES = new Set(["freeform", "wall", "stream", "timeline", "kanban"]);
const PRIVACY_TYPES = new Set(["public", "private", "link", "domain"]);

/**
 * Six characters from an alphabet with no O/0 or I/1 in it, because these get
 * read off a projector and typed in by a room full of people.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () =>
  [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

/** `join_code` is UNIQUE, so a collision is a retry rather than a duplicate wall. */
async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode();
    const taken = await db.prepare(`SELECT 1 AS ok FROM walls WHERE join_code = ?`).bind(code).first();
    if (!taken) return code;
  }
  throw new HttpError(503, "Couldn't allocate a join code — try again.");
}

const postsFor = async (wallId: string): Promise<PostRow[]> => {
  const rows = await db
    .prepare(`SELECT * FROM posts WHERE wall_id = ? ORDER BY z_index ASC, created_at ASC`)
    .bind(wallId)
    .all<PostRow>();
  return rows.results ?? [];
};

const etagFor = (wall: WallRow) => `W/"${wall.rev}"`;

/* ---------- the dashboard ---------- */

/**
 * The walls this person should see on their dashboard.
 *
 * Posts are deliberately not included: the dashboard only prints a count, and
 * fetching every post of every wall to render a number was most of what made
 * signing in slow.
 */
app.get(
  "/api/walls",
  handler(async (c) => {
    const user = await requireUser(c);

    const rows =
      user.role === "teacher"
        ? await db
            .prepare(`SELECT * FROM walls WHERE teacher_id = ? ORDER BY created_at DESC`)
            .bind(user.id)
            .all<WallRow>()
        : await db
            .prepare(
              `SELECT w.* FROM walls w
                 JOIN wall_members m ON m.wall_id = w.id
                WHERE m.user_id = ?
                ORDER BY m.last_accessed_at DESC`,
            )
            .bind(user.id)
            .all<WallRow>();

    const walls = rows.results ?? [];
    if (walls.length === 0) return c.json({ walls: [] });

    const placeholders = walls.map(() => "?").join(",");
    const counts = await db
      .prepare(`SELECT wall_id, COUNT(*) AS n FROM posts WHERE wall_id IN (${placeholders}) GROUP BY wall_id`)
      .bind(...walls.map((w) => w.id))
      .all<{ wall_id: string; n: number }>();
    const byWall = new Map((counts.results ?? []).map((r) => [r.wall_id, r.n]));

    return c.json({
      walls: walls.map((w) => ({ ...wallShape(w), postCount: byWall.get(w.id) ?? 0 })),
    });
  }),
);

app.post(
  "/api/walls",
  handler(async (c) => {
    const user = await requireTeacher(c);
    const body = await c.req.json<Record<string, any>>();

    const type = WALL_TYPES.has(body.type) ? body.type : "freeform";
    const privacy = PRIVACY_TYPES.has(body.privacyType) ? body.privacyType : "link";
    const id = uid();
    const code = await uniqueCode();

    await db
      .prepare(
        `INSERT INTO walls (id, name, type, description, join_code, teacher_id, background,
                            snap_to_grid, is_anonymous, is_frozen, privacy_type, icon,
                            require_login_to_post, rev, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        String(body.name ?? "").trim() || "Untitled Wall",
        type,
        String(body.description ?? "").trim() || "No description.",
        code,
        user.id,
        String(body.background ?? "") || "from-indigo-500 via-purple-500 to-pink-500",
        body.snapToGrid === false ? 0 : 1,
        body.isAnonymous ? 1 : 0,
        0,
        privacy,
        String(body.icon ?? "") || "📝",
        body.requireLoginToPost ? 1 : 0,
        now(),
        now(),
      )
      .run();

    await joinWall(id, user.id, "teacher");
    const wall = await db.prepare(`SELECT * FROM walls WHERE id = ?`).bind(id).first<WallRow>();
    return c.json({ wall: { ...wallShape(wall!), postCount: 0 } }, 201);
  }),
);

/* ---------- opening a wall ---------- */

/**
 * One wall and everything on it.
 *
 * Send back the `ETag` you were given as `If-None-Match` and an unchanged wall
 * answers 304 with nothing in it, which is what the 3-second poll does.
 */
app.get(
  "/api/walls/:id",
  handler(async (c) => {
    const { wall } = await requireReadableWall(c, param(c, "id"));
    const etag = etagFor(wall);
    if (c.req.header("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
    }
    return c.json({ wall: wallShape(wall, await postsFor(wall.id)) }, 200, {
      ETag: etag,
      "Cache-Control": "no-cache",
    });
  }),
);

/** Resolve a join code typed on the sign-in screen, or one pasted in a link. */
app.get(
  "/api/walls/by-code/:code",
  handler(async (c) => {
    const wall = await wallByCode(param(c, "code"));
    if (!wall) throw new HttpError(404, "No wall has that code.");
    const user = await currentUser(c);
    if (!(await canReadWall(wall, user))) throw new HttpError(403, "You don't have access to that wall.");
    return c.json({ wall: wallShape(wall, await postsFor(wall.id)) });
  }),
);

/** Remember that this person has been here, so the wall reaches their dashboard. */
app.post(
  "/api/walls/:id/join",
  handler(async (c) => {
    const { wall, user } = await requireReadableWall(c, param(c, "id"));
    if (!user) throw new HttpError(401, "You're not signed in.");
    await joinWall(wall.id, user.id, wall.teacher_id === user.id ? "teacher" : user.role);
    return c.json({ ok: true });
  }),
);

/* ---------- changing a wall ---------- */

/** Column per settable field. Anything not listed here can't be set from a request. */
const WALL_FIELDS: Record<string, { column: string; encode: (v: any) => unknown }> = {
  name: { column: "name", encode: (v) => String(v ?? "").trim() || "Untitled Wall" },
  description: { column: "description", encode: (v) => String(v ?? "") },
  background: { column: "background", encode: (v) => String(v ?? "") },
  icon: { column: "icon", encode: (v) => String(v ?? "") || "📝" },
  type: { column: "type", encode: (v) => (WALL_TYPES.has(v) ? v : "freeform") },
  privacyType: { column: "privacy_type", encode: (v) => (PRIVACY_TYPES.has(v) ? v : "link") },
  snapToGrid: { column: "snap_to_grid", encode: (v) => (v ? 1 : 0) },
  isAnonymous: { column: "is_anonymous", encode: (v) => (v ? 1 : 0) },
  isFrozen: { column: "is_frozen", encode: (v) => (v ? 1 : 0) },
  requireLoginToPost: { column: "require_login_to_post", encode: (v) => (v ? 1 : 0) },
};

app.patch(
  "/api/walls/:id",
  handler(async (c) => {
    const { wall } = await requireWallOwner(c, param(c, "id"));
    const body = await c.req.json<Record<string, any>>();

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, spec] of Object.entries(WALL_FIELDS)) {
      if (body[key] !== undefined) {
        sets.push(`${spec.column} = ?`);
        values.push(spec.encode(body[key]));
      }
    }
    if (sets.length === 0) return c.json({ wall: wallShape(wall) });

    // The rev bump rides along with the update rather than following it, so a
    // poll can never land between the two and cache the old wall under the new
    // revision.
    await db
      .prepare(`UPDATE walls SET ${sets.join(", ")}, rev = rev + 1, updated_at = ? WHERE id = ?`)
      .bind(...values, now(), wall.id)
      .run();

    const updated = await db.prepare(`SELECT * FROM walls WHERE id = ?`).bind(wall.id).first<WallRow>();
    return c.json({ wall: wallShape(updated!) });
  }),
);

app.delete(
  "/api/walls/:id",
  handler(async (c) => {
    const { wall } = await requireWallOwner(c, param(c, "id"));
    await deleteWallCompletely(wall.id);
    return c.json({ ok: true });
  }),
);

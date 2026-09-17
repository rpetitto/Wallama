/**
 * Posts: the things on a wall.
 *
 * Two rules run through all of it. The author is whoever the Worker says is
 * making the request — never a name in the payload, which is how a student
 * could previously post as their teacher. And every write bumps the wall's
 * `rev`, because a change nobody's poll notices may as well not have happened.
 */

import { app, db } from "../platform";
import {
  HttpError,
  handler,
  requirePoster,
  requireUser,
  wallById,
  bumpWallRev,
  now,
  uid,
  param,
} from "../lib/session";
import { postShape, type PostRow } from "../lib/shape";

const POST_TYPES = new Set(["title", "text", "image", "link", "gif", "video", "ai", "drive"]);

/** Metadata is small, structured, and written by our own editor — not a dumping ground. */
const MAX_METADATA_BYTES = 8_192;

function encodeMetadata(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  const json = JSON.stringify(value);
  if (json.length > MAX_METADATA_BYTES) {
    throw new HttpError(
      413,
      "That post carries too much extra data. Media is uploaded separately — see /api/media.",
    );
  }
  return json;
}

/**
 * The next z-index on a wall.
 *
 * Both adding a post and moving one put it on top, which is why this is shared.
 * It is a read-then-write rather than `MAX(z_index) + 1` in the UPDATE because
 * the same value is also needed in the response.
 */
async function nextZ(wallId: string): Promise<number> {
  const top = await db
    .prepare(`SELECT MAX(z_index) AS z FROM posts WHERE wall_id = ?`)
    .bind(wallId)
    .first<{ z: number | null }>();
  return (top?.z ?? 0) + 1;
}

const postById = (id: string) => db.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first<PostRow>();

/**
 * The post, the wall it is on, and the person asking — with the check that the
 * person may change it already done.
 *
 * Its author may, and so may the teacher whose wall it is: moderating a class
 * wall is the whole job, and a teacher who can't take down a post can't do it.
 */
async function requireEditablePost(c: Parameters<typeof requireUser>[0], postId: string) {
  const post = await postById(postId);
  if (!post) throw new HttpError(404, "That post doesn't exist.");
  const wall = await wallById(post.wall_id);
  if (!wall) throw new HttpError(404, "That post's wall doesn't exist.");

  const user = await requireUser(c);
  const isOwner = wall.teacher_id === user.id;
  if (post.author_id !== user.id && !isOwner) throw new HttpError(403, "That's not your post.");
  if (wall.is_frozen && !isOwner) throw new HttpError(403, "This wall is frozen.");
  return { post, wall, user, isOwner };
}

app.post(
  "/api/walls/:id/posts",
  handler(async (c) => {
    const wall = await wallById(param(c, "id"));
    if (!wall) throw new HttpError(404, "That wall doesn't exist.");
    const user = await requirePoster(c, wall);

    const body = await c.req.json<Record<string, any>>();
    const id = uid();
    const z = await nextZ(wall.id);

    // A reply has to point at a post on this same wall, or the canvas would
    // render a child whose parent it will never load.
    let parentId: string | null = body.parentId ?? null;
    if (parentId) {
      const parent = await postById(parentId);
      if (!parent || parent.wall_id !== wall.id) parentId = null;
    }

    await db
      .prepare(
        `INSERT INTO posts (id, wall_id, type, title, content, author_id, author_name, author_avatar,
                            x, y, z_index, color, parent_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        wall.id,
        POST_TYPES.has(body.type) ? body.type : "text",
        body.title ? String(body.title) : null,
        String(body.content ?? ""),
        user.id,
        user.name,
        user.avatar ?? null,
        Math.round(Number(body.x) || 100),
        Math.round(Number(body.y) || 100),
        z,
        String(body.color ?? "") || "bg-white",
        parentId,
        encodeMetadata(body.metadata),
        now(),
        now(),
      )
      .run();

    await bumpWallRev(wall.id);
    const created = await postById(id);
    return c.json({ post: postShape(created!) }, 201);
  }),
);

/** Columns a post's own editor may set. Position has its own route. */
const POST_FIELDS: Record<string, { column: string; encode: (v: any) => unknown }> = {
  title: { column: "title", encode: (v) => (v === null ? null : String(v)) },
  content: { column: "content", encode: (v) => String(v ?? "") },
  type: { column: "type", encode: (v) => (POST_TYPES.has(v) ? v : "text") },
  color: { column: "color", encode: (v) => String(v ?? "") || "bg-white" },
  metadata: { column: "metadata", encode: encodeMetadata },
};

app.patch(
  "/api/posts/:id",
  handler(async (c) => {
    const { post, wall } = await requireEditablePost(c, param(c, "id"));
    const body = await c.req.json<Record<string, any>>();

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, spec] of Object.entries(POST_FIELDS)) {
      if (body[key] !== undefined) {
        sets.push(`${spec.column} = ?`);
        values.push(spec.encode(body[key]));
      }
    }

    // `parentId` is what a drag between kanban columns changes, so it is settable
    // — but only to a post on the same wall, and never to itself.
    if (body.parentId !== undefined) {
      let parentId: string | null = body.parentId ?? null;
      if (parentId) {
        const parent = await postById(parentId);
        if (!parent || parent.wall_id !== wall.id || parent.id === post.id) parentId = null;
      }
      sets.push(`parent_id = ?`);
      values.push(parentId);
    }

    if (sets.length === 0) return c.json({ post: postShape(post) });

    await db
      .prepare(`UPDATE posts SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...values, now(), post.id)
      .run();
    await bumpWallRev(wall.id);

    const updated = await postById(post.id);
    return c.json({ post: postShape(updated!) });
  }),
);

/**
 * Dragging.
 *
 * Separate from the editor's PATCH because the permission is different: anyone
 * who may post on a wall may rearrange it, which is the point of a shared
 * canvas, while only an author (or the teacher) may rewrite what a post says.
 */
app.patch(
  "/api/posts/:id/position",
  handler(async (c) => {
    const post = await postById(param(c, "id"));
    if (!post) throw new HttpError(404, "That post doesn't exist.");
    const wall = await wallById(post.wall_id);
    if (!wall) throw new HttpError(404, "That post's wall doesn't exist.");
    await requirePoster(c, wall);

    const body = await c.req.json<{ x?: number; y?: number; parentId?: string | null }>();
    const z = await nextZ(wall.id);

    let parentId = post.parent_id;
    if (body.parentId !== undefined) {
      parentId = body.parentId ?? null;
      if (parentId) {
        const parent = await postById(parentId);
        if (!parent || parent.wall_id !== wall.id || parent.id === post.id) parentId = null;
      }
    }

    await db
      .prepare(`UPDATE posts SET x = ?, y = ?, z_index = ?, parent_id = ?, updated_at = ? WHERE id = ?`)
      .bind(
        Math.round(Number(body.x) || 0),
        Math.round(Number(body.y) || 0),
        z,
        parentId,
        now(),
        post.id,
      )
      .run();
    await bumpWallRev(wall.id);

    return c.json({ ok: true, zIndex: z });
  }),
);

app.delete(
  "/api/posts/:id",
  handler(async (c) => {
    const { post, wall } = await requireEditablePost(c, param(c, "id"));
    // Replies are anchored to their parent, so deleting a column or a timeline
    // milestone takes what was attached to it rather than orphaning it off-canvas.
    await db.batch([
      db.prepare(`DELETE FROM posts WHERE parent_id = ?`).bind(post.id),
      db.prepare(`DELETE FROM posts WHERE id = ?`).bind(post.id),
    ]);
    await bumpWallRev(wall.id);
    return c.json({ ok: true });
  }),
);

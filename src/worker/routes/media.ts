/**
 * Pictures and videos.
 *
 * These used to be base64 data URLs stored in the post row itself. That worked
 * on Postgres and does not work here — but the reason to change it was never
 * D1's limits. A 3MB photo became a 4MB string that every client re-downloaded
 * on every three-second poll of the wall, for as long as the wall was open.
 *
 * Now the bytes go to R2 once and the row keeps a path. The browser caches them
 * because the key never changes contents: a new upload is a new key.
 */

import { app, db, storage } from "../platform";
import {
  HttpError,
  handler,
  requirePoster,
  currentUser,
  canReadWall,
  wallById,
  now,
  uid,
  param,
} from "../lib/session";

/**
 * 25MB. Videos are recorded in the browser at whatever quality the camera
 * gives, and a classroom on school wifi is the wrong place to discover there
 * was no ceiling at all.
 */
const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/**
 * Upload one file to a wall.
 *
 * The body is the file itself rather than a multipart form: there is only ever
 * one file and no other fields, and `request.arrayBuffer()` avoids parsing a
 * 25MB multipart envelope to get at something already sitting in the body.
 */
app.post(
  "/api/walls/:id/media",
  handler(async (c) => {
    const wall = await wallById(param(c, "id"));
    if (!wall) throw new HttpError(404, "That wall doesn't exist.");
    const user = await requirePoster(c, wall);

    const contentType = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = EXTENSIONS[contentType];
    if (!extension) {
      throw new HttpError(415, `Wallama can't store ${contentType || "that kind of file"}.`);
    }

    // Checked before reading the body where the header offers an answer, so an
    // oversized upload is refused rather than buffered and then refused.
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > MAX_BYTES) {
      throw new HttpError(413, `That file is too big — the limit is ${MAX_BYTES / 1024 / 1024}MB.`);
    }

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new HttpError(400, "That file was empty.");
    if (bytes.byteLength > MAX_BYTES) {
      throw new HttpError(413, `That file is too big — the limit is ${MAX_BYTES / 1024 / 1024}MB.`);
    }

    // Everything a wall owns lives under the wall's own prefix, which is what
    // lets deleting the wall sweep its media in one pass.
    const key = `walls/${wall.id}/media/${uid()}.${extension}`;
    await storage.put(key, bytes, { contentType });
    await db
      .prepare(
        `INSERT INTO media (key, wall_id, uploaded_by, content_type, byte_length, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(key, wall.id, user.id, contentType, bytes.byteLength, now())
      .run();

    return c.json({ key, url: `/api/media/${key}` }, 201);
  }),
);

/**
 * Read a `Range: bytes=…` header, if it is one we can serve.
 *
 * Only a single range is handled — a suffix range (`bytes=-500`) and multipart
 * ranges are answered with the whole file instead, which is a legal response
 * and is what every player this app sees actually asks for anyway.
 */
function parseRange(header: string | undefined): { offset: number; length?: number } | undefined {
  const match = header?.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return undefined;
  const offset = Number(match[1]);
  if (!match[2]) return { offset };
  const end = Number(match[2]);
  if (end < offset) return undefined;
  return { offset, length: end - offset + 1 };
}

/**
 * Serve an uploaded file.
 *
 * Access follows the wall it belongs to, so media on a private wall isn't
 * readable by URL alone — the cost is one indexed lookup, and the response is
 * marked `private` and cached for a year because the key is never reused.
 */
app.get(
  "/api/media/*",
  handler(async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/media\//, ""));
    if (!key || key.includes("..")) throw new HttpError(400, "That isn't a media path.");

    const row = await db
      .prepare(`SELECT wall_id, content_type FROM media WHERE key = ?`)
      .bind(key)
      .first<{ wall_id: string; content_type: string }>();
    if (!row) throw new HttpError(404, "No such file.");

    const wall = await wallById(row.wall_id);
    if (!wall) throw new HttpError(404, "No such file.");
    if (!(await canReadWall(wall, await currentUser(c)))) {
      throw new HttpError(403, "You don't have access to that wall.");
    }

    // A `<video>` asks for byte ranges rather than the whole file, and answering
    // with the whole file anyway is how a recording ends up refusing to play on
    // iOS. `Accept-Ranges` on the full response is what tells it it may ask.
    const requested = parseRange(c.req.header("Range"));
    const object = await storage.get(key, requested);
    if (!object) throw new HttpError(404, "No such file.");

    if (c.req.header("If-None-Match") === object.httpEtag) {
      return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
    }

    const headers: Record<string, string> = {
      "Content-Type": object.contentType ?? row.content_type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      ETag: object.httpEtag,
    };

    // `requested`, not `object.range`: R2 reports the range it returned on every
    // get, including a whole-object one, so keying off it alone answered an
    // ordinary request with a 206 and no Content-Range at all.
    if (requested && object.range) {
      const { offset, length } = object.range;
      headers["Content-Length"] = String(length);
      headers["Content-Range"] = `bytes ${offset}-${offset + length - 1}/${object.size}`;
      return new Response(object.body, { status: 206, headers });
    }

    headers["Content-Length"] = String(object.size);
    return new Response(object.body, { headers });
  }),
);

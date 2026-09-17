/**
 * Wallama's schema.
 *
 * Carried over from the Supabase Postgres tables, with three deliberate
 * differences:
 *
 *  - `users` and `sessions` are new. Identity used to be a JSON blob in the
 *    browser's localStorage that the client sent along with every write, which
 *    meant anyone could claim to be any teacher. The Worker mints its own
 *    session now and the client never names an author.
 *  - `walls.rev` is new. It counts every change to a wall or to any post on it,
 *    which is what lets a client poll with `If-None-Match` and get an empty 304
 *    back when nothing has happened — see routes/walls.ts.
 *  - Media is a key in R2 rather than a base64 data URL in a text column.
 */

import { migrate, db } from "./platform";

migrate("001_core", async () => {
  // One row per person. Guests get a row too, so a post always has a real
  // author and `wall_members` works the same for everyone.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_sub TEXT UNIQUE,
      email TEXT,
      name TEXT NOT NULL,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      is_guest INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    )
  `).run();

  // Opaque random ids looked up here, which is why the cookie needs no signing
  // secret to be unforgeable — there is nothing in it to forge.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS walls (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'freeform',
      description TEXT NOT NULL DEFAULT '',
      join_code TEXT NOT NULL UNIQUE,
      teacher_id TEXT NOT NULL,
      background TEXT NOT NULL DEFAULT 'from-indigo-500 via-purple-500 to-pink-500',
      snap_to_grid INTEGER NOT NULL DEFAULT 1,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      is_frozen INTEGER NOT NULL DEFAULT 0,
      privacy_type TEXT NOT NULL DEFAULT 'link',
      icon TEXT NOT NULL DEFAULT '📝',
      require_login_to_post INTEGER NOT NULL DEFAULT 0,
      rev INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_walls_teacher ON walls(teacher_id)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS wall_members (
      wall_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (wall_id, user_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_members_user ON wall_members(user_id, last_accessed_at DESC)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      wall_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT 'anon',
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      author_avatar TEXT,
      x INTEGER NOT NULL DEFAULT 100,
      y INTEGER NOT NULL DEFAULT 100,
      z_index INTEGER NOT NULL DEFAULT 1,
      color TEXT NOT NULL DEFAULT 'bg-white',
      parent_id TEXT,
      -- JSON. D1 has no jsonb; the app only ever reads the whole object back.
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_wall ON posts(wall_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_wall_z ON posts(wall_id, z_index DESC)`).run();

  // Every R2 object a wall owns. The bucket itself could be listed by prefix,
  // but a wall's media is also swept when the wall is deleted and this is the
  // record of what was uploaded and by whom — a list call can't answer that.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS media (
      key TEXT PRIMARY KEY,
      wall_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_media_wall ON media(wall_id)`).run();
});

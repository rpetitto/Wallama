/**
 * Turning database rows into what the app already expects.
 *
 * The client's `Wall` and `Post` types are unchanged from the Supabase build,
 * so this file is the whole of the difference between the two backends as far
 * as the React code is concerned: snake_case to camelCase, integers back to
 * booleans, timestamps back to epoch milliseconds, and `metadata` out of the
 * TEXT column it lives in now that there is no jsonb.
 */

import type { WallRow } from "./session";

export interface PostRow {
  id: string;
  wall_id: string;
  type: string;
  title: string | null;
  content: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  x: number;
  y: number;
  z_index: number;
  color: string;
  parent_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/**
 * SQLite's `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" with no zone, which
 * `Date.parse` reads as local time — an hours-wide error in a field the app
 * sorts a timeline by. Everything this Worker writes is a full ISO string; this
 * only has to rescue a row that took a column default.
 */
export function epoch(value: string | null): number {
  if (!value) return Date.now();
  const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function postShape(row: PostRow) {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    // A row we can't parse is still a post worth showing; it just has no extras.
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title ?? "",
    content: row.content ?? "",
    authorName: row.author_name ?? "Anonymous",
    authorId: row.author_id ?? "",
    authorAvatar: row.author_avatar ?? "",
    createdAt: epoch(row.created_at),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    zIndex: Number(row.z_index) || 1,
    color: row.color || "bg-white",
    parentId: row.parent_id ?? undefined,
    metadata,
  };
}

export function wallShape(row: WallRow, posts: PostRow[] = []) {
  return {
    id: row.id,
    name: row.name || "Untitled Wall",
    type: row.type || "freeform",
    description: row.description ?? "",
    joinCode: row.join_code ?? "",
    teacherId: row.teacher_id ?? "",
    background: row.background || "from-indigo-500 via-purple-500 to-pink-500",
    snapToGrid: !!row.snap_to_grid,
    isAnonymous: !!row.is_anonymous,
    isFrozen: !!row.is_frozen,
    privacyType: row.privacy_type || "link",
    icon: row.icon || "📝",
    requireLoginToPost: !!row.require_login_to_post,
    rev: row.rev,
    posts: posts.map(postShape),
  };
}

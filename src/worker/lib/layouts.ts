/**
 * Switching a wall from one layout to another.
 *
 * The five layouts read a post's position differently. Freeform uses x and y as
 * a spot on the canvas. Kanban uses `parentId` for the column a card is in and
 * y for its order there, and x for the order of the columns themselves.
 * Timeline uses x for a milestone's slot on the line and `parentId` for the
 * details hanging under it. Wall and Stream ignore position entirely and list
 * posts by when they were made.
 *
 * So a switch has two jobs. Every post has to land somewhere sensible in the
 * new layout, and the layout being left has to be remembered, so that switching
 * back puts everything where it was. The memory is `posts.layouts`, a small
 * JSON map from layout name to the spot the post had there.
 *
 * Posts with no remembered spot in the new layout — every post, the first time
 * a wall enters a layout, and afterwards only the ones added since — are
 * fitted in by the rules below, which try to keep whatever order and grouping
 * the old layout gave them.
 *
 * Everything here is arithmetic on plain objects. The database work is in
 * routes/walls.ts, which applies the result in one batch.
 */

import {
  CARD_GAP,
  KANBAN_COLUMN_WIDTH,
  KANBAN_COLUMN_Y,
  KANBAN_START_X,
  MILESTONE_SPACING,
  TIMELINE_AXIS_Y,
  type WallTypeName,
} from "../../shared/layout";

export interface Spot {
  x: number;
  y: number;
  parentId: string | null;
}

/** A post's remembered spot in each layout the wall has been in. */
export type LayoutMemory = Partial<Record<WallTypeName, Spot>>;

export interface LayoutPost {
  id: string;
  type: string;
  title: string | null;
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
  x: number;
  y: number;
  parentId: string | null;
  layouts: LayoutMemory;
}

export interface Placement extends Spot {
  id: string;
  layouts: LayoutMemory;
}

export interface Rearrangement {
  placements: Placement[];
  /**
   * A column to create before the placements are written, when Kanban needs
   * somewhere to put posts that have never been in one. Its id is already used
   * as the `parentId` of the posts that go in it.
   */
  newColumn?: { id: string; title: string; x: number; y: number };
}

/** Layouts where a post's spot means something, and so is worth remembering. */
const REMEMBERED = new Set<string>(["freeform", "kanban", "timeline"]);

/**
 * Layouts where one post belongs to another: a card to its column, a detail to
 * its milestone. Everywhere else `parentId` is cleared, because deleting a post
 * deletes whatever hangs off it — which on a Freeform canvas would take out
 * cards nobody can see are attached.
 */
export const HIERARCHICAL = new Set<string>(["kanban", "timeline"]);

export const UNSORTED_COLUMN = "Unsorted";

const snap = (v: number) => Math.round(v / 20) * 20;

/* ---------- how tall a card is likely to be ---------- */

/**
 * A guess at a card's rendered height on the canvas, for stacking cards in
 * Freeform without overlapping them.
 *
 * The Worker can't measure anything, and the sizes here are read off Post.tsx
 * at its 300px width. They err tall on purpose: a gap between two cards looks
 * deliberate, an overlap looks broken.
 */
export function estimateHeight(p: Pick<LayoutPost, "type" | "title" | "content" | "metadata">): number {
  const CHROME = 32 + 36 + 44; // padding, the author row, the timestamp row
  const lines = (text: string, perLine: number) =>
    text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  const plain = (md: string) => md.replace(/[#*_>`~\[\]()!-]/g, "");
  const meta = p.metadata ?? {};

  let body: number;
  switch (p.type) {
    case "title":
    case "text": {
      body = 0;
      if (meta.image) body += 140;
      if (p.title) body += lines(p.title, 18) * 28 + 8;
      const text = plain(p.content ?? "");
      if (text.trim()) body += lines(text, 32) * 24 + 12;
      break;
    }
    case "image":
      body = String(p.content).includes("from-") ? 200 : 264;
      break;
    case "gif":
      body = 230;
      break;
    case "link": {
      const url = String(meta.url ?? p.content ?? "");
      body = /youtu|vimeo|loom/.test(url) ? 170 : meta.image ? 210 : 90;
      break;
    }
    case "drive":
      body = 90;
      break;
    case "video":
      body = 170;
      break;
    case "ai":
      body = lines(p.content ?? "", 34) * 22 + 50;
      break;
    default:
      body = lines(p.content ?? "", 32) * 24;
  }
  if (meta.caption && p.type !== "title" && p.type !== "text") {
    body += 36 + lines(String(meta.caption), 32) * 20;
  }
  return CHROME + Math.max(40, body);
}

/* ---------- the order posts read in, in the layout being left ---------- */

interface Group {
  /** A column, a milestone — or, in a flat layout, just the post itself. */
  head: LayoutPost;
  members: LayoutPost[];
}

/**
 * Freeform in reading order: rows top to bottom, each row left to right.
 *
 * A post counts as being on the same row as the one that started it if its top
 * is within half a card of it, so a hand-arranged row that isn't pixel-straight
 * still reads as a row.
 */
function readingOrder(posts: LayoutPost[]): LayoutPost[] {
  const byY = [...posts].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: LayoutPost[][] = [];
  let rowTop = -Infinity;
  for (const p of byY) {
    if (p.y > rowTop + 150) {
      rows.push([p]);
      rowTop = p.y;
    } else {
      rows[rows.length - 1].push(p);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * The posts of the layout being left, grouped the way that layout grouped them
 * and in the order it showed them.
 *
 * Kanban and Timeline give one group per column or milestone. The flat layouts
 * give one group per post. A card whose column no longer exists becomes a group
 * of its own rather than disappearing.
 */
function groupsOf(from: string, posts: LayoutPost[]): Group[] {
  const byCreated = (a: LayoutPost, b: LayoutPost) => a.createdAt - b.createdAt;

  if (HIERARCHICAL.has(from)) {
    const heads = posts.filter((p) => !p.parentId).sort((a, b) => a.x - b.x || byCreated(a, b));
    const headIds = new Set(heads.map((h) => h.id));
    const groups = heads.map((head) => {
      const children = posts.filter((p) => p.parentId === head.id);
      children.sort(from === "kanban" ? (a, b) => a.y - b.y || byCreated(a, b) : byCreated);
      return { head, members: [head, ...children] };
    });
    const orphans = posts.filter((p) => p.parentId && !headIds.has(p.parentId)).sort(byCreated);
    return [...groups, ...orphans.map((p) => ({ head: p, members: [p] }))];
  }

  const ordered = from === "freeform" ? readingOrder(posts) : [...posts].sort(byCreated);
  return ordered.map((p) => ({ head: p, members: [p] }));
}

/* ---------- the switch ---------- */

export function rearrange(
  from: string,
  to: string,
  posts: LayoutPost[],
  makeId: () => string,
): Rearrangement {
  // Remember the layout being left. Freeform has no hierarchy to remember.
  const memory = new Map<string, LayoutMemory>();
  for (const p of posts) {
    const layouts: LayoutMemory = { ...p.layouts };
    if (REMEMBERED.has(from)) {
      layouts[from as WallTypeName] = { x: p.x, y: p.y, parentId: from === "freeform" ? null : p.parentId };
    }
    memory.set(p.id, layouts);
  }

  const groups = groupsOf(from, posts);
  const spots = new Map<string, Spot>();
  let newColumn: Rearrangement["newColumn"];

  if (to === "freeform") {
    toFreeform(groups, memory, HIERARCHICAL.has(from), spots);
  } else if (to === "kanban") {
    newColumn = toKanban(groups, memory, HIERARCHICAL.has(from), spots, makeId);
  } else if (to === "timeline") {
    toTimeline(groups, memory, HIERARCHICAL.has(from), spots);
  } else {
    // Wall and Stream list posts by when they were made and never read x or y,
    // so those are left alone. Only the hierarchy goes.
    for (const p of posts) spots.set(p.id, { x: p.x, y: p.y, parentId: null });
  }

  return {
    placements: posts.map((p) => ({ id: p.id, ...spots.get(p.id)!, layouts: memory.get(p.id)! })),
    newColumn,
  };
}

/**
 * Freeform: remembered posts go back exactly where they were. Everything else
 * is laid out below them — or from the top left, on a first visit — so nothing
 * lands on top of an arrangement someone made by hand.
 *
 * Coming from Kanban or Timeline, each column or milestone becomes a stack with
 * its cards underneath, which keeps the grouping visible. Coming from a flat
 * layout, posts fill a roughly square grid in the order they were listed.
 */
function toFreeform(groups: Group[], memory: Map<string, LayoutMemory>, fromHierarchy: boolean, spots: Map<string, Spot>) {
  const all = groups.flatMap((g) => g.members);
  const newcomers = new Set<string>();

  let bottom = -Infinity;
  let left = Infinity;
  for (const p of all) {
    const m = memory.get(p.id)?.freeform;
    // (0, 0) is where a post with no position used to end up, and Post.tsx
    // treats it as "not on the canvas" — so it doesn't count as a memory.
    if (m && (m.x !== 0 || m.y !== 0)) {
      spots.set(p.id, { x: m.x, y: m.y, parentId: null });
      bottom = Math.max(bottom, m.y + estimateHeight(p));
      left = Math.min(left, m.x);
    } else {
      newcomers.add(p.id);
    }
  }
  if (newcomers.size === 0) return;

  const x0 = Number.isFinite(left) ? left : 100;
  const y0 = Number.isFinite(bottom) ? snap(bottom + 2 * CARD_GAP) : 100;
  const pitch = KANBAN_COLUMN_WIDTH; // a card and a gap, same as everywhere else

  if (fromHierarchy) {
    const stacks = groups.map((g) => g.members.filter((p) => newcomers.has(p.id))).filter((s) => s.length > 0);
    stacks.forEach((stack, i) => {
      let y = y0;
      for (const p of stack) {
        spots.set(p.id, { x: snap(x0 + i * pitch), y: snap(y), parentId: null });
        y += estimateHeight(p) + CARD_GAP;
      }
    });
    return;
  }

  const queue = all.filter((p) => newcomers.has(p.id));
  const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(queue.length))));
  const heights = new Array<number>(cols).fill(0);
  for (const p of queue) {
    const col = heights.indexOf(Math.min(...heights));
    spots.set(p.id, { x: snap(x0 + col * pitch), y: snap(y0 + heights[col]), parentId: null });
    heights[col] += estimateHeight(p) + CARD_GAP;
  }
}

/**
 * Kanban: columns are posts with no parent, cards are posts with one.
 *
 * A remembered column comes back in its old order. A remembered card comes back
 * to its old column, if that column is still a column. Anything else:
 *
 *  - from Timeline, a milestone becomes a column and its details its cards;
 *  - a post from a flat layout, or a card whose column is gone, goes into a
 *    column called "Unsorted" — created if there isn't one — rather than
 *    being filed under a category nobody chose for it.
 */
function toKanban(
  groups: Group[],
  memory: Map<string, LayoutMemory>,
  fromHierarchy: boolean,
  spots: Map<string, Spot>,
  makeId: () => string,
): Rearrangement["newColumn"] {
  const all = groups.flatMap((g) => g.members);
  const remembered = (p: LayoutPost) => memory.get(p.id)?.kanban;

  const oldColumns = all
    .filter((p) => remembered(p)?.parentId === null)
    .sort((a, b) => remembered(a)!.x - remembered(b)!.x);
  const newColumns = fromHierarchy ? all.filter((p) => !remembered(p) && !p.parentId) : [];
  const columns = [...oldColumns, ...newColumns];
  const columnIds = new Set(columns.map((c) => c.id));

  // Cards, each with the column it goes in. Remembered ones keep their order
  // key; the rest are appended in the order the old layout showed them.
  const cards = new Map<string, { post: LayoutPost; y: number | null; x: number }[]>();
  const add = (columnId: string, post: LayoutPost, y: number | null, x = 0) => {
    if (!cards.has(columnId)) cards.set(columnId, []);
    cards.get(columnId)!.push({ post, y, x });
  };

  let unsortedId: string | null = null;
  let newColumn: Rearrangement["newColumn"];
  const unsorted = () => {
    if (unsortedId) return unsortedId;
    const existing = columns.find((c) => (c.title || c.content || "").trim().toLowerCase() === UNSORTED_COLUMN.toLowerCase());
    if (existing) return (unsortedId = existing.id);
    unsortedId = makeId();
    newColumn = { id: unsortedId, title: UNSORTED_COLUMN, x: 0, y: KANBAN_COLUMN_Y };
    return unsortedId;
  };

  for (const p of all) {
    if (columnIds.has(p.id)) continue;
    const m = remembered(p);
    if (m?.parentId && columnIds.has(m.parentId)) add(m.parentId, p, m.y, m.x);
    else if (fromHierarchy && p.parentId && columnIds.has(p.parentId)) add(p.parentId, p, null);
    else add(unsorted(), p, null);
  }

  // Columns are re-spaced evenly: the order is what's remembered, and closing
  // up the gap a deleted column left behind is a kindness.
  const order = newColumn ? [...columns.map((c) => c.id), newColumn.id] : columns.map((c) => c.id);
  order.forEach((id, i) => {
    const x = KANBAN_START_X + i * KANBAN_COLUMN_WIDTH;
    if (newColumn && id === newColumn.id) newColumn.x = x;
    else spots.set(id, { x, y: KANBAN_COLUMN_Y, parentId: null });
  });

  for (const [columnId, list] of cards) {
    const kept = list.filter((c) => c.y !== null);
    let next = Math.max(0, ...kept.map((c) => c.y!)) + 20;
    // A card's x means nothing in Kanban (its column places it), but a
    // remembered one is put back as it was so a round trip changes nothing.
    for (const { post, y, x } of list) {
      spots.set(post.id, { x, y: y ?? next, parentId: columnId });
      if (y === null) next += 20;
    }
  }

  return newColumn;
}

/**
 * Timeline: milestones are posts with no parent, spaced along the line; details
 * hang under them.
 *
 * Remembered milestones come back in their old order, remembered details under
 * their old milestone if it is still one. From Kanban a column becomes a
 * milestone and its cards its details. Anything else becomes a milestone of its
 * own, appended in the order the old layout showed it — left to right, top to
 * bottom on a Freeform canvas; oldest first in Wall and Stream.
 */
function toTimeline(groups: Group[], memory: Map<string, LayoutMemory>, fromHierarchy: boolean, spots: Map<string, Spot>) {
  const all = groups.flatMap((g) => g.members);
  const remembered = (p: LayoutPost) => memory.get(p.id)?.timeline;

  const milestones = all
    .filter((p) => remembered(p)?.parentId === null)
    .sort((a, b) => remembered(a)!.x - remembered(b)!.x);
  const isMilestone = new Set(milestones.map((m) => m.id));

  // Posts that were heads in the old layout become milestones before anyone
  // looks for a parent, so a card can follow its column across.
  for (const p of all) {
    if (!remembered(p) && !(fromHierarchy && p.parentId) && !isMilestone.has(p.id)) {
      milestones.push(p);
      isMilestone.add(p.id);
    }
  }

  const details: { post: LayoutPost; parentId: string }[] = [];
  for (const p of all) {
    if (isMilestone.has(p.id)) continue;
    const m = remembered(p);
    if (m?.parentId && isMilestone.has(m.parentId)) details.push({ post: p, parentId: m.parentId });
    else if (fromHierarchy && p.parentId && isMilestone.has(p.parentId)) details.push({ post: p, parentId: p.parentId });
    else {
      milestones.push(p);
      isMilestone.add(p.id);
    }
  }

  milestones.forEach((m, i) => spots.set(m.id, { x: i * MILESTONE_SPACING, y: TIMELINE_AXIS_Y, parentId: null }));
  for (const { post, parentId } of details) {
    const m = remembered(post);
    spots.set(post.id, { x: m?.x ?? 0, y: m?.y ?? 0, parentId });
  }
}

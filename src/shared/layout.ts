/**
 * Where the canvas layouts put things, shared by the app that draws them and
 * the Worker that rearranges a wall when its layout changes.
 *
 * These were constants inside WallView. Switching layouts moved the arithmetic
 * that places a post into the Worker as well, and two copies of "a timeline
 * milestone sits every 340px along y = 450" would drift apart the first time
 * someone restyled one of them.
 */

export const WALL_TYPES = ["freeform", "wall", "stream", "timeline", "kanban"] as const;
export type WallTypeName = (typeof WALL_TYPES)[number];

/** Every canvas post is this wide; the grid and the stacks are spaced from it. */
export const CARD_WIDTH = 300;
export const CARD_GAP = 40;

/** Timeline milestones sit on one horizontal line, one slot apart. */
export const TIMELINE_AXIS_Y = 450;
export const MILESTONE_SPACING = CARD_WIDTH + CARD_GAP;

/** Kanban columns run left to right from here, cards stacked inside them. */
export const KANBAN_START_X = 50;
export const KANBAN_COLUMN_Y = 50;
export const KANBAN_COLUMN_WIDTH = CARD_WIDTH + CARD_GAP;

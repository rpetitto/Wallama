/**
 * The database handle the rest of the Worker writes against.
 *
 * It is this short because D1's binding *is* the implementation — the only
 * thing added is resolving which database, per request, so that changing that
 * decision later is a change here rather than at every call site.
 */

import { currentDb } from "./context";

export const db: D1Database = {
  prepare: (query: string) => currentDb().prepare(query),
  batch: (statements: D1PreparedStatement[]) => currentDb().batch(statements),
  exec: (query: string) => currentDb().exec(query),
  withSession: (constraint?: string) => currentDb().withSession(constraint),
  dump: () => currentDb().dump(),
} as D1Database;

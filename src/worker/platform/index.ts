/**
 * The platform the application is written against.
 *
 * Every module under `src/worker` imports `app`, `db` and `storage` from here
 * rather than reaching for `env.DB` or `env.BUCKET` directly. That seam is what
 * made leaving Supabase a matter of rewriting one layer, and it is worth
 * keeping for the same reason next time.
 */

import { Hono } from "hono";
import type { Bindings } from "./context";

export const app = new Hono<{ Bindings: Bindings }>();

export { db } from "./db";
export { storage } from "./storage";
export { migrate, runMigrations, registeredMigrations } from "./migrate";
export { runInScope, currentEnv, currentDb, currentScope } from "./context";
export type { Bindings, RequestScope } from "./context";
export type { StorageObject, StoragePutOptions } from "./storage";

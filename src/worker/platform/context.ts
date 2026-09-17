/**
 * Which bindings the code currently running should use.
 *
 * Supabase handed out one `supabase` client as a module-level singleton, but on
 * Workers the bindings arrive per request on `env`. An async-local store is what
 * bridges the two, and it is deliberately not a plain module variable: one
 * isolate serves many requests at once, so a shared variable would be a race
 * waiting to happen the first time this app runs against more than one database.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Public by design — the Worker checks that an ID token was issued to this app. */
  GOOGLE_CLIENT_ID?: string;
  GEMINI_MODEL?: string;
  /** Secrets: `wrangler secret put`, or .dev.vars locally. Never in wrangler.jsonc. */
  GEMINI_API_KEY?: string;
  GIPHY_API_KEY?: string;
  PEXELS_API_KEY?: string;
  [key: string]: unknown;
}

export interface RequestScope {
  env: Bindings;
  ctx: ExecutionContext;
  /** The database this request works against. */
  db: D1Database;
}

const store = new AsyncLocalStorage<RequestScope>();

export function runInScope<T>(scope: RequestScope, fn: () => T): T {
  return store.run(scope, fn);
}

export function currentScope(): RequestScope {
  const scope = store.getStore();
  if (!scope) {
    throw new Error(
      "No request scope. Platform primitives can only be used inside a request, " +
        "a scheduled run, or a migration — not at module load time.",
    );
  }
  return scope;
}

export const currentEnv = () => currentScope().env;
export const currentDb = () => currentScope().db;

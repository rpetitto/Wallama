/**
 * The Worker itself.
 *
 * It has three jobs, and they are the three things that used to be somebody
 * else's: put this request's bindings in scope, make sure the database has its
 * schema before anything queries it, and hand the request to the app.
 *
 * Only `/api/*` gets here at all — `wrangler.jsonc` serves the built SPA
 * straight from the edge — so opening a wall costs no Worker invocation for the
 * page itself.
 */

import { app, runInScope, runMigrations, type Bindings } from "./platform";
import "./index";

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return runInScope({ env, ctx, db: env.DB }, async () => {
      await runMigrations();
      return app.fetch(request, env, ctx);
    });
  },
};

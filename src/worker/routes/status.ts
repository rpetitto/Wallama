/**
 * Is this deployment actually working?
 *
 * It probes rather than reporting a value someone set by hand: a status
 * endpoint that can't fail is worse than not having one. What it does not do is
 * name which secrets are missing to anyone who asks — `configured` says whether
 * a feature will work, which is what a person debugging a blank GIF tab needs,
 * without turning the endpoint into an inventory of the deployment.
 */

import { app, db, storage, registeredMigrations } from "../platform";
import { handler } from "../lib/session";

app.get(
  "/api/health",
  handler(async (c) => c.json({ ok: true, service: "wallama" })),
);

app.get(
  "/api/status",
  handler(async (c) => {
    const checks: Record<string, boolean> = {};

    try {
      await db.prepare(`SELECT 1 AS ok`).first();
      checks.database = true;
    } catch (err) {
      console.error("status: database", err);
      checks.database = false;
    }

    try {
      await storage.get("__status_probe__");
      checks.storage = true;
    } catch (err) {
      console.error("status: storage", err);
      checks.storage = false;
    }

    return c.json({
      ok: Object.values(checks).every(Boolean),
      checks,
      configured: {
        googleSignIn: !!c.env.GOOGLE_CLIENT_ID,
        ai: !!c.env.ANTHROPIC_API_KEY,
        gifSearch: !!c.env.GIPHY_API_KEY,
        imageSearch: !!c.env.PEXELS_API_KEY,
      },
      migrations: registeredMigrations(),
    });
  }),
);

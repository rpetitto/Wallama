/**
 * Wallama's backend.
 *
 * Everything the app registers — the schema's migrations and every route —
 * declares itself as a side effect of being imported here. `entry.ts` is the
 * Worker itself and does only what the runtime needs.
 *
 * Google Classroom and Drive are still called straight from the browser with
 * the teacher's own OAuth token, exactly as before: this Worker holds no Google
 * API credentials, and a student is never asked for Classroom scopes.
 */

import "./schema";
import "./routes/auth";
import "./routes/walls";
import "./routes/posts";
import "./routes/media";
import "./routes/ai";
import "./routes/search";
import "./routes/status";

import { app } from "./platform";

/**
 * Anything under /api that no route claimed is a 404 in JSON, not the SPA's
 * index.html — a client that asked for data and got a page back reports a JSON
 * parse error, which says nothing about the actual mistake.
 */
app.all("/api/*", (c) => c.json({ error: "No such endpoint." }, 404));

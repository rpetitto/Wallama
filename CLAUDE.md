# Wallama

Read `README.md` first — it covers the layout, the commands, the first deploy,
and the handful of things that are easy to break. This file is only what that
doesn't say.

## Working here

- `npm run typecheck` checks both projects (`tsc -b`). Run it before saying
  something works; the worker project is `strict`, the SPA is not.
- `npm run dev` gives you real D1 and R2 locally, so a change to a route can be
  exercised with `curl` against `http://localhost:8787` without a Cloudflare
  account. `npx wrangler d1 execute wallama --local --command "..."` reads the
  local database — handy for seeding a session row to stand in for Google
  sign-in, which can't be done from a terminal.
- Deploying needs Cloudflare credentials. If the token has been revoked, ask
  rather than working around it.

## Where things go

- A new endpoint is a route file under `src/worker/routes/`, imported from
  `src/worker/index.ts`. Wrap the body in `handler()` so a thrown `HttpError`
  becomes clean JSON.
- A permission check goes in `src/worker/lib/session.ts` next to the others,
  never in a component. The server is the only thing that decides what someone
  may do; the client hiding a button is a courtesy, not a control.
- A schema change is a new `migrate(...)` in `src/worker/schema.ts`. Never edit
  one that has already run.
- Anything that changes a wall or a post must bump the wall's `rev`
  (`bumpWallRev`), or nobody else polling the wall will see it.

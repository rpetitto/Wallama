# Wallama

A collaborative wall for teachers and students to share thoughts on a live
digital canvas.

Runs on Cloudflare — Workers, D1 and R2 — in Robert's own account. It was moved
off Google AI Studio and Supabase in September 2026; nothing depends on either
any more. The AI features run on Claude (`src/worker/routes/ai.ts`).

## Layout

```
src/worker/            the API (Hono) and the platform layer over Cloudflare bindings
src/worker/platform/   db, storage, migrations — the seam over the bindings
src/worker/routes/     auth, walls, posts, media, ai, search, status
src/react-app/         the SPA
public/                static files served from the edge
```

`src/worker/platform` exists on purpose. Application code imports `db`,
`storage` and `app` from there rather than reaching for `env.DB` and
`env.BUCKET` directly, so leaving Supabase cost one layer rather than an edit at
every call site — and the next such move would too.

## Running it

```
npm install
npm run dev        wrangler dev — the whole thing with real bindings, port 8787
npm run dev:ui     vite with HMR, proxying /api to wrangler on 8787
npm run build      builds the SPA into dist/client
npm run deploy     build then deploy
npm run typecheck  both projects (tsc -b)
```

`npm run dev` simulates D1 and R2 locally, so nothing here needs a Cloudflare
account to run.

## First deploy

```
npx wrangler d1 create wallama            # put the id in wrangler.jsonc
npx wrangler r2 bucket create wallama-media
npx wrangler secret put ANTHROPIC_API_KEY # AI refine, safety check, wall icons, wallpaper search
npx wrangler secret put GIPHY_API_KEY     # the GIF tab in the post editor
npx wrangler secret put PEXELS_API_KEY    # the image-search tab
npm run deploy
```

Secrets never go in `wrangler.jsonc`. Locally they live in `.dev.vars`
(gitignored) under the same names — copy `.dev.vars.example` to start.

The Google **client id** is not a secret and is in `wrangler.jsonc` on purpose:
it appears in the page source of every site that offers Google sign-in, the
Worker needs it to check that a token was issued to *this* app, and there is no
matching secret to protect. Whichever Google Cloud project it belongs to needs
this deployment's origin in its authorized JavaScript origins.

The schema is not a deploy step — see below.

## Deploying from GitHub

`.github/workflows/deploy.yml` builds, typechecks and deploys on every push to
`main`, and on demand from the Actions tab. It needs one repository secret,
**`CLOUDFLARE_API_TOKEN`** — a token made from the "Edit Cloudflare Workers"
template with **D1 → Edit** added.

It also carries the Worker's own secrets: any of **`ANTHROPIC_API_KEY`**,
**`GIPHY_API_KEY`** and **`PEXELS_API_KEY`** present as a repository secret is
pushed into the Worker with `wrangler secret put` on every deploy, and one that
isn't is skipped. So a key is set or rotated by editing the repository secret
and re-running the deploy — no laptop, no wrangler. (Make the Anthropic key
inside a workspace; an organization-level key needs `ANTHROPIC_WORKSPACE_ID`
in `wrangler.jsonc` as well, or every request is refused with a 400.) To manage
  another Worker secret the same way, add its name to the `secrets:` list in
  the workflow and the matching repository secret.

The account id in the workflow is not a secret. Deploying this way instead of
from a laptop means every deploy is the same deploy.

## Things worth knowing before changing them

- **Migrations run themselves** on the first request, tracked in `_migrations`,
  so a fresh D1 database needs no setup command. They are registered in
  `src/worker/schema.ts` and applied in name order; add a new one rather than
  editing an applied one.

- **`walls.rev` is the polling contract.** Every write to a wall or to any post
  on it bumps it, and `GET /api/walls/:id` returns it as an `ETag`. A client
  polling with `If-None-Match` gets an empty 304 when nothing has happened,
  which is what almost every poll gets. A write that forgets to bump it is
  invisible to everyone else on the wall — use `bumpWallRev`.

- **Media lives in R2, not the database.** Everything a wall owns sits under
  `walls/{id}/`, which is what lets deleting the wall sweep it in one pass, so
  nothing else may point into that prefix. Post rows keep a path under
  `/api/media`; they used to keep base64 data URLs, which meant everyone
  looking at a wall re-downloaded every picture on it three times a second.

- **The client never says who it is.** Identity is a session cookie the Worker
  issued after verifying something Google signed; `authorId` and `teacherId` in
  a request body are ignored. Permission checks belong in
  `src/worker/lib/session.ts` next to the others, not in a component that hides
  a button.

- **Anonymous walls are anonymous in the UI only.** The server sends real author
  names and `Post.tsx` hides them when the wall is set to anonymous — unchanged
  from the Supabase build, and worth knowing before promising a class more than
  that.

- **Classroom and Drive are called from the browser** with the teacher's own
  OAuth token, so this Worker holds no Google API credentials and a student is
  never asked for Classroom scopes. Sign-in is the one exception: the token is
  passed to the Worker once, used to ask Classroom whether this person teaches
  anything, and not stored.

- **The canvas owns its touch gestures.** Three things together stop a downward
  drag on a phone from becoming the browser's pull-to-refresh:
  `overscroll-behavior: none` on `html`/`body` (index.css), `touch-none` on the
  canvas element, and a *native* `touchmove` listener registered with
  `passive: false` in `WallView`. React's own `onTouchMove` is registered
  passive, so a `preventDefault()` inside a JSX handler does nothing — the
  original code had one and it never worked. Don't move that logic back into
  JSX. Overlays are bottom sheets below the `sm` breakpoint and centred
  dialogs above it; fixed bottom controls offset by `env(safe-area-inset-bottom)`.

- **Tailwind is v3**, compiled at build time. It was `cdn.tailwindcss.com`,
  which compiles in the browser on every page load and which Tailwind's own docs
  tell you not to ship. Staying on 3 keeps every existing class name meaning
  what it means today; moving to 4 is a separate change with its own visual
  review.

/**
 * The three third-party lookups the post editor makes.
 *
 * Giphy's and Pexels' keys were string literals in PostEditor.tsx, shipped to
 * every browser that loaded the app. They are Worker secrets now, and the
 * browser asks these endpoints instead. Microlink needs no key but is proxied
 * alongside them so the editor has one place to call and the page isn't
 * fetching from three more origins.
 *
 * All three require a session — an open image-search proxy on someone else's
 * quota is exactly the thing being fixed here.
 */

import { app } from "../platform";
import { HttpError, handler, requireUser } from "../lib/session";

/** The upstream's own error text can name the key, so it is logged, not returned. */
async function upstream<T>(name: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    console.error(`${name} error`, res.status, (await res.text()).slice(0, 300));
    throw new HttpError(502, `${name} didn't answer. Try again in a moment.`);
  }
  return (await res.json()) as T;
}

/** Trending when there's no query, which is what the GIF tab opens on. */
app.get(
  "/api/search/gifs",
  handler(async (c) => {
    await requireUser(c);
    const key = c.env.GIPHY_API_KEY;
    if (!key) throw new HttpError(503, "GIF search isn't configured for this deployment.");

    const query = (c.req.query("q") ?? "").trim();
    const url =
      query && query !== "trending"
        ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=25&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=25&rating=g`;

    const data = await upstream<{ data?: unknown[] }>("Giphy", url);
    return c.json({ gifs: data.data ?? [] });
  }),
);

app.get(
  "/api/search/images",
  handler(async (c) => {
    await requireUser(c);
    const key = c.env.PEXELS_API_KEY;
    if (!key) throw new HttpError(503, "Image search isn't configured for this deployment.");

    const query = (c.req.query("q") ?? "").trim();
    if (!query) throw new HttpError(400, "No search given.");

    const data = await upstream<{ photos?: unknown[] }>(
      "Pexels",
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=12&orientation=landscape`,
      { headers: { Authorization: key } },
    );
    return c.json({ photos: data.photos ?? [] });
  }),
);

/**
 * The title/description/image behind a pasted link.
 *
 * Only http(s) is passed on: this endpoint fetches whatever it is handed, and
 * without that check it would happily dereference `file:` or an internal
 * address on someone else's behalf.
 */
app.get(
  "/api/search/link-preview",
  handler(async (c) => {
    await requireUser(c);
    const target = (c.req.query("url") ?? "").trim();

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new HttpError(400, "That isn't a URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError(400, "Only http and https links can be previewed.");
    }

    const data = await upstream<{ status?: string; data?: Record<string, any> }>(
      "Microlink",
      `https://api.microlink.io?url=${encodeURIComponent(parsed.toString())}`,
    );
    if (data.status !== "success" || !data.data) return c.json({ preview: null });

    return c.json({
      preview: {
        url: parsed.toString(),
        title: data.data.title ?? null,
        description: data.data.description ?? null,
        image: data.data.image?.url ?? data.data.logo?.url ?? null,
      },
    });
  }),
);

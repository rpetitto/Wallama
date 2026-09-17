/**
 * Claude, from the server.
 *
 * Every one of these calls used to run in the browser against Gemini with
 * `new GoogleGenAI({ apiKey: process.env.API_KEY })`, and Vite's `define`
 * substituted the real key into the bundle at build time — so the key was
 * readable in devtools by anyone who loaded the page, and billable by anyone
 * who copied it. That is the single most important thing this migration fixes.
 *
 * The key is a Worker secret now and the browser calls these endpoints instead.
 * They require a session, so they are not an open proxy.
 */

import Anthropic from "@anthropic-ai/sdk";
import { app, storage } from "../platform";
import { HttpError, handler, requireUser, requireTeacher } from "../lib/session";

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Thinking is on by default on Opus 5, and these are small, well-specified
 * jobs — an emoji, a safety verdict, five discussion prompts. Low effort keeps
 * the latency and the bill proportionate to that; `max_tokens` still has to
 * leave room for the thinking itself, which is why none of these are set as
 * tight as the visible answers would suggest.
 */
const EFFORT_LOW = { effort: "low" } as const;

function claude(env: { ANTHROPIC_API_KEY?: string }): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "AI features aren't configured for this deployment.");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

const modelFor = (env: { ANTHROPIC_MODEL?: string }) => env.ANTHROPIC_MODEL || DEFAULT_MODEL;

/** The text Claude actually wrote, with thinking and tool blocks left out. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Turn an API failure into something safe to show a teacher.
 *
 * The upstream message can name the key or the organization, so it is logged
 * rather than returned.
 */
function apiFailed(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.APIError) {
    console.error("Claude API error", err.status, err.message);
    return new HttpError(502, "The AI service didn't answer. Try again in a moment.");
  }
  console.error("Claude call failed", err);
  return new HttpError(502, "The AI service didn't answer. Try again in a moment.");
}

/** Tidy up or riff on what someone typed. */
app.post(
  "/api/ai/refine",
  handler(async (c) => {
    await requireUser(c);
    const { prompt, type } = await c.req.json<{ prompt?: string; type?: "text" | "creative" }>();
    if (!prompt?.trim()) throw new HttpError(400, "Nothing to refine.");

    try {
      const message = await claude(c.env).messages.create({
        model: modelFor(c.env),
        max_tokens: 16000,
        output_config: EFFORT_LOW,
        system:
          "You help a teacher and their students write posts for a shared classroom wall. " +
          "Reply with the post text only — no preamble, no quotation marks, no commentary.",
        messages: [
          {
            role: "user",
            content:
              type === "creative"
                ? `Write a creative response or thought about this topic for a class discussion board: "${prompt}"`
                : `Rewrite this post to be clear, engaging, and appropriate for a classroom: "${prompt}"`,
          },
        ],
      });
      return c.json({ text: textOf(message) || "Sorry, I couldn't refine that." });
    } catch (err) {
      throw apiFailed(err);
    }
  }),
);

app.post(
  "/api/ai/topics",
  handler(async (c) => {
    await requireTeacher(c);
    const { subject } = await c.req.json<{ subject?: string }>();
    if (!subject?.trim()) throw new HttpError(400, "No subject given.");

    try {
      const message = await claude(c.env).messages.create({
        model: modelFor(c.env),
        max_tokens: 4096,
        output_config: {
          ...EFFORT_LOW,
          // A schema rather than "reply with JSON" in the prompt: the response
          // is parsed, so a stray sentence around it is a crash, not a nuisance.
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { topics: { type: "array", items: { type: "string" } } },
              required: ["topics"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: "user",
            content: `Give 5 engaging discussion topics or prompt titles for a collaborative classroom wall about ${subject}.`,
          },
        ],
      });

      const parsed = JSON.parse(textOf(message)) as { topics?: unknown };
      if (Array.isArray(parsed.topics)) return c.json({ topics: parsed.topics });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error("topics failed", err);
    }
    return c.json({ topics: ["General Discussion", "Reflections", "Questions", "Resources"] });
  }),
);

/** A single emoji for a new wall, from its name. */
app.post(
  "/api/ai/icon",
  handler(async (c) => {
    await requireTeacher(c);
    const { name } = await c.req.json<{ name?: string }>();
    if (!name?.trim()) throw new HttpError(400, "No wall name given.");

    try {
      const message = await claude(c.env).messages.create({
        model: modelFor(c.env),
        max_tokens: 2048,
        output_config: EFFORT_LOW,
        messages: [
          {
            role: "user",
            content: `Suggest a single emoji that represents the topic: "${name}". Reply with only the emoji character.`,
          },
        ],
      });
      const emoji = textOf(message);
      return c.json({ icon: emoji && [...emoji].length <= 2 ? emoji : null });
    } catch (err) {
      throw apiFailed(err);
    }
  }),
);

/**
 * A wallpaper URL for a wall background, found by searching the web.
 *
 * Web search is a server tool — Claude runs the search on Anthropic's side and
 * the results come back in the same response, so there is no search loop here.
 * `pause_turn` is the one thing that needs handling: it means the turn was cut
 * short mid-tool-use and should be continued by sending the response back.
 */
app.post(
  "/api/ai/background",
  handler(async (c) => {
    await requireTeacher(c);
    const { query } = await c.req.json<{ query?: string }>();
    if (!query?.trim()) throw new HttpError(400, "No search given.");

    try {
      const client = claude(c.env);
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content:
            `Search the web for a high-quality wallpaper image suitable as a classroom wall background for "${query}". ` +
            `Reply with only the direct https URL of the image file — nothing else.`,
        },
      ];

      let message = await client.messages.create({
        model: modelFor(c.env),
        max_tokens: 8192,
        output_config: EFFORT_LOW,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
        messages,
      });

      // Bounded rather than `while`: a turn that keeps pausing should end as a
      // button that did nothing, not as a Worker burning the teacher's budget.
      for (let i = 0; i < 3 && message.stop_reason === "pause_turn"; i++) {
        messages.push({ role: "assistant", content: message.content });
        message = await client.messages.create({
          model: modelFor(c.env),
          max_tokens: 8192,
          output_config: EFFORT_LOW,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
          messages,
        });
      }

      const url = textOf(message).replace(/`/g, "").trim();
      return c.json({ url: /^https:\/\/\S+$/.test(url) ? url : null });
    } catch (err) {
      throw apiFailed(err);
    }
  }),
);

/** The image types Claude accepts. An SVG upload is skipped rather than refused. */
const VISIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Is this fit for a K-12 wall?
 *
 * An uploaded image is named by its R2 key rather than sent again — it is
 * already on the server by this point, and re-uploading a photo as base64 just
 * to ask about it is the pattern this migration is getting rid of.
 *
 * Fails open, as it always has: when the check itself breaks, a post goes up.
 * A moderator that blocks the class when the model is slow is worse than one
 * that occasionally misses.
 */
app.post(
  "/api/ai/safety",
  handler(async (c) => {
    await requireUser(c);
    const { text, mediaKey } = await c.req.json<{ text?: string; mediaKey?: string }>();
    if (!text?.trim() && !mediaKey) return c.json({ isSafe: true });

    try {
      const content: Anthropic.ContentBlockParam[] = [];

      if (mediaKey) {
        const object = await storage.get(mediaKey);
        // Video goes up unchecked, as it did before.
        if (object?.contentType && VISIBLE_IMAGE_TYPES.has(object.contentType)) {
          const bytes = new Uint8Array(await object.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: object.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: btoa(binary),
            },
          });
        }
      }

      content.push({ type: "text", text: `Analyze this for school safety: ${text ?? ""}` });

      const message = await claude(c.env).messages.create({
        model: modelFor(c.env),
        max_tokens: 8192,
        output_config: {
          ...EFFORT_LOW,
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { isSafe: { type: "boolean" }, reason: { type: "string" } },
              required: ["isSafe"],
              additionalProperties: false,
            },
          },
        },
        system:
          "You are a moderator for a K-12 school app. Analyze content for safety. " +
          'Return {"isSafe": false, "reason": "..."} for profanity, hate speech, nudity, ' +
          'violence, or illegal acts. Otherwise return {"isSafe": true}. ' +
          "The reason is shown to a student, so keep it short and matter-of-fact.",
        messages: [{ role: "user", content }],
      });

      const result = JSON.parse(textOf(message) || '{"isSafe":true}') as { isSafe?: boolean; reason?: string };
      return c.json({
        isSafe: result.isSafe === true,
        reason: result.isSafe ? undefined : result.reason || "Content flagged as inappropriate.",
      });
    } catch (err) {
      console.warn("Safety check failed (allowing content):", err);
      return c.json({ isSafe: true });
    }
  }),
);

/**
 * Gemini, from the server.
 *
 * Every one of these calls used to run in the browser with
 * `new GoogleGenAI({ apiKey: process.env.API_KEY })`, and Vite's `define`
 * substituted the real key into the bundle at build time — so the key was
 * readable in devtools by anyone who loaded the page, and billable by anyone
 * who copied it. That is the single most important thing this migration fixes.
 *
 * The key is a Worker secret now and the browser calls these endpoints instead.
 * They require a session, so they are not an open Gemini proxy.
 */

import { app, storage } from "../platform";
import { HttpError, handler, requireUser, requireTeacher } from "../lib/session";

const DEFAULT_MODEL = "gemini-3-flash-preview";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GenerateOptions {
  parts: GeminiPart[];
  systemInstruction?: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  googleSearch?: boolean;
}

/**
 * One call to Gemini's REST API.
 *
 * Plain `fetch` rather than `@google/genai`: the SDK's whole job here was to
 * build this request body, and a Worker pays for every byte of its bundle on
 * cold start.
 */
async function generate(
  env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string },
  options: GenerateOptions,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, "AI features aren't configured for this deployment.");
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: options.parts }],
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
    },
  };
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }
  if (options.googleSearch) body.tools = [{ googleSearch: {} }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    // The upstream message can name the key or the project, so it is logged
    // rather than returned.
    console.error("Gemini error", res.status, (await res.text()).slice(0, 500));
    throw new HttpError(502, "The AI service didn't answer. Try again in a moment.");
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

/** Tidy up or riff on what someone typed. */
app.post(
  "/api/ai/refine",
  handler(async (c) => {
    await requireUser(c);
    const { prompt, type } = await c.req.json<{ prompt?: string; type?: "text" | "creative" }>();
    if (!prompt?.trim()) throw new HttpError(400, "Nothing to refine.");

    const text = await generate(c.env, {
      parts: [
        {
          text:
            type === "creative"
              ? `Generate a creative response or thought about this topic for a class discussion board: "${prompt}"`
              : `Refine this educational post to be clear, engaging, and professional for a classroom setting: "${prompt}"`,
        },
      ],
    });
    return c.json({ text: text || "Sorry, I couldn't refine that." });
  }),
);

app.post(
  "/api/ai/topics",
  handler(async (c) => {
    await requireTeacher(c);
    const { subject } = await c.req.json<{ subject?: string }>();
    if (!subject?.trim()) throw new HttpError(400, "No subject given.");

    const text = await generate(c.env, {
      parts: [
        {
          text: `Provide 5 engaging discussion topics or prompt titles for a collaborative classroom wall about ${subject}.`,
        },
      ],
      responseMimeType: "application/json",
      responseSchema: { type: "ARRAY", items: { type: "STRING" } },
    });

    try {
      const topics = JSON.parse(text);
      if (Array.isArray(topics)) return c.json({ topics });
    } catch {
      /* fall through to the default set */
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

    const text = await generate(c.env, {
      parts: [{ text: `Suggest a single emoji that represents the topic: "${name}". Return only the emoji character.` }],
    });
    const emoji = text.trim();
    return c.json({ icon: emoji && [...emoji].length <= 2 ? emoji : null });
  }),
);

/** A wallpaper URL for a wall background, found with search grounding. */
app.post(
  "/api/ai/background",
  handler(async (c) => {
    await requireTeacher(c);
    const { query } = await c.req.json<{ query?: string }>();
    if (!query?.trim()) throw new HttpError(400, "No search given.");

    const text = await generate(c.env, {
      // This prompt used to name the model "gemgemini-3-flash-preview", so the
      // request 404'd and the button quietly did nothing every time.
      parts: [
        {
          text: `Find a direct URL to a high-quality professional wallpaper for "${query}". Return ONLY the URL string.`,
        },
      ],
      googleSearch: true,
    });

    const url = text.replace(/`/g, "").trim();
    return c.json({ url: /^https:\/\//.test(url) ? url : null });
  }),
);

/**
 * Is this fit for a K-12 wall?
 *
 * An uploaded image is named by its R2 key rather than sent again — it is
 * already on the server by this point, and re-uploading a photo as base64 just
 * to ask about it is the pattern this migration is getting rid of.
 *
 * Fails open, as it always has: when the check itself breaks, a post goes up.
 * A moderator that blocks the class when Gemini is slow is worse than one that
 * occasionally misses.
 */
app.post(
  "/api/ai/safety",
  handler(async (c) => {
    await requireUser(c);
    const { text, mediaKey } = await c.req.json<{ text?: string; mediaKey?: string }>();
    if (!text?.trim() && !mediaKey) return c.json({ isSafe: true });

    try {
      const parts: GeminiPart[] = [];

      if (mediaKey) {
        const object = await storage.get(mediaKey);
        // Gemini takes inline images; video goes up unchecked, as it did before.
        if (object && object.contentType?.startsWith("image/")) {
          const bytes = new Uint8Array(await object.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          parts.push({ inlineData: { mimeType: object.contentType, data: btoa(binary) } });
        }
      }

      parts.push({ text: `Analyze this for school safety: ${text ?? ""}` });

      const answer = await generate(c.env, {
        parts,
        systemInstruction: `You are a moderator for a K-12 school app. Analyze content for safety.
    Return {"isSafe": false, "reason": "..."} for: Profanity, Hate Speech, Nudity, Violence, or Illegal acts.
    Otherwise return {"isSafe": true}.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { isSafe: { type: "BOOLEAN" }, reason: { type: "STRING" } },
          required: ["isSafe"],
        },
      });

      const result = JSON.parse(answer || '{"isSafe":true}');
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

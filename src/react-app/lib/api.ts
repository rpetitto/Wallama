/**
 * Everything the app asks the server for.
 *
 * This replaces `services/databaseService.ts`, which spoke to Supabase directly
 * from the browser using a publishable key that allowed any read and any write.
 * The method names are kept where they were, so the components read much as
 * they did — what changed is that the server now decides whether each of these
 * is allowed, and the client no longer says who it is.
 */

import type { Post, User, Wall } from "../types";

export class ApiError extends Error {
  /** Whatever the server attached under `detail` — an upstream status, say. */
  constructor(public status: number, message: string, public detail?: Record<string, unknown>) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof ArrayBuffer) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* ---------- who's signed in ---------- */

export const authService = {
  /** The session, if there is one. Null is a normal answer, not an error. */
  async me(): Promise<User | null> {
    try {
      const { user } = await api.get<{ user: User | null }>("/api/me");
      return user;
    } catch {
      return null;
    }
  },

  /**
   * Hand Google's proof to our server, which checks it and issues a session.
   *
   * Wallama's one button asks for Classroom access and identity together, so
   * what comes back is an access token; `credential` is there for an ID token
   * if a plain sign-in button is ever added. Either way the access token goes
   * along so the server can ask Classroom whether this person teaches anything
   * — the role decides who may create and delete walls, so it can't be the
   * browser's answer to give.
   */
  async signInWithGoogle(proof: { credential?: string; accessToken?: string }): Promise<User> {
    const { user } = await api.post<{ user: User }>("/api/auth/google", proof);
    return user;
  },

  async signInAsGuest(): Promise<User> {
    const { user } = await api.post<{ user: User }>("/api/auth/guest");
    return user;
  },

  async signOut(): Promise<void> {
    await api.post("/api/auth/leave");
  },
};

/* ---------- walls and posts ---------- */

/**
 * The wall as it was last fetched, by id, so a poll can say "I already have
 * revision 7" and be told there's nothing newer. The server answers that with
 * an empty 304 instead of every post on the wall.
 */
const revisions = new Map<string, string>();

export const databaseService = {
  /** The walls for this person's dashboard. Posts aren't included — only the count is. */
  async getMyWalls(): Promise<Wall[]> {
    try {
      const { walls } = await api.get<{ walls: Wall[] }>("/api/walls");
      return walls;
    } catch (err) {
      console.error("getMyWalls failed:", err);
      return [];
    }
  },

  /**
   * One wall and everything on it.
   *
   * Returns `unchanged` when the wall hasn't moved since the last call, which
   * is what the three-second poll gets almost every time.
   */
  async getWall(id: string): Promise<{ wall: Wall | null; unchanged: boolean }> {
    const known = revisions.get(id);
    const res = await fetch(`/api/walls/${id}`, {
      credentials: "same-origin",
      headers: known ? { "If-None-Match": known } : {},
    });

    if (res.status === 304) return { wall: null, unchanged: true };
    if (res.status === 404 || res.status === 403) return { wall: null, unchanged: false };
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);

    const etag = res.headers.get("ETag");
    if (etag) revisions.set(id, etag);
    const { wall } = (await res.json()) as { wall: Wall };
    return { wall, unchanged: false };
  },

  /** Plain fetch with no revision tracking, for the first load of a wall. */
  async getWallById(id: string): Promise<Wall | null> {
    try {
      const { wall } = await api.get<{ wall: Wall }>(`/api/walls/${id}`);
      return wall;
    } catch {
      return null;
    }
  },

  async getWallByCode(code: string): Promise<Wall | null> {
    try {
      const { wall } = await api.get<{ wall: Wall }>(`/api/walls/by-code/${encodeURIComponent(code)}`);
      return wall;
    } catch {
      return null;
    }
  },

  async joinWall(wallId: string): Promise<void> {
    try {
      await api.post(`/api/walls/${wallId}/join`);
    } catch (err) {
      // Reaching the wall is what matters; the dashboard entry is a nicety.
      console.warn("Couldn't record the wall visit:", err);
    }
  },

  async createWall(wall: Partial<Wall>): Promise<Wall | null> {
    try {
      const { wall: created } = await api.post<{ wall: Wall }>("/api/walls", wall);
      return created;
    } catch (err) {
      console.error("createWall failed:", err);
      return null;
    }
  },

  async updateWall(wallId: string, updates: Partial<Wall>): Promise<boolean> {
    try {
      await api.patch(`/api/walls/${wallId}`, updates);
      return true;
    } catch (err) {
      console.error("updateWall failed:", err);
      return false;
    }
  },

  async deleteWall(wallId: string): Promise<boolean> {
    try {
      await api.del(`/api/walls/${wallId}`);
      revisions.delete(wallId);
      return true;
    } catch (err) {
      console.error("deleteWall failed:", err);
      return false;
    }
  },

  async addPost(wallId: string, post: Partial<Post>): Promise<Post | null> {
    try {
      const { post: created } = await api.post<{ post: Post }>(`/api/walls/${wallId}/posts`, post);
      return created;
    } catch (err) {
      console.error("addPost failed:", err);
      return null;
    }
  },

  async updatePostContent(postId: string, post: Partial<Post>): Promise<Post | null> {
    try {
      const { post: updated } = await api.patch<{ post: Post }>(`/api/posts/${postId}`, post);
      return updated;
    } catch (err) {
      console.error("updatePostContent failed:", err);
      return null;
    }
  },

  async updatePostPosition(postId: string, x: number, y: number, parentId?: string | null): Promise<boolean> {
    try {
      await api.patch(`/api/posts/${postId}/position`, { x, y, parentId });
      return true;
    } catch (err) {
      console.error("updatePostPosition failed:", err);
      return false;
    }
  },

  async deletePost(postId: string): Promise<boolean> {
    try {
      await api.del(`/api/posts/${postId}`);
      return true;
    } catch (err) {
      console.error("deletePost failed:", err);
      return false;
    }
  },

  /**
   * Put a file on a wall and get back the path it lives at.
   *
   * The body is the file itself. It used to be read into a base64 string and
   * stored in the post row, which meant everyone looking at the wall
   * re-downloaded it on every poll.
   */
  async uploadMedia(wallId: string, file: Blob): Promise<{ key: string; url: string }> {
    const res = await fetch(`/api/walls/${wallId}/media`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as { key: string; url: string };
  },
};

/* ---------- Gemini, and the two search APIs ---------- */

export const aiService = {
  async refinePostContent(prompt: string, type: "text" | "creative"): Promise<string> {
    try {
      const { text } = await api.post<{ text: string }>("/api/ai/refine", { prompt, type });
      return text;
    } catch (err) {
      console.error("AI refine failed:", err);
      return "AI Refinement currently unavailable.";
    }
  },

  async suggestWallTopics(subject: string): Promise<string[]> {
    try {
      const { topics } = await api.post<{ topics: string[] }>("/api/ai/topics", { subject });
      return topics;
    } catch {
      return ["General Discussion", "Reflections", "Questions", "Resources"];
    }
  },

  async suggestWallIcon(name: string): Promise<string | null> {
    try {
      const { icon } = await api.post<{ icon: string | null }>("/api/ai/icon", { name });
      return icon;
    } catch {
      return null;
    }
  },

  async findBackground(query: string): Promise<string | null> {
    try {
      const { url } = await api.post<{ url: string | null }>("/api/ai/background", { query });
      return url;
    } catch {
      return null;
    }
  },

  /**
   * Fails open, as it always has: when the check itself breaks the post goes
   * up. A moderator that blocks the class when the AI is slow is worse than one
   * that occasionally misses.
   */
  async checkContentSafety(text: string, mediaKey?: string): Promise<{ isSafe: boolean; reason?: string }> {
    try {
      return await api.post<{ isSafe: boolean; reason?: string }>("/api/ai/safety", { text, mediaKey });
    } catch (err) {
      console.warn("Safety check failed (allowing content):", err);
      return { isSafe: true };
    }
  },
};

export const searchService = {
  /**
   * Returns the failure alongside the (empty) results rather than hiding it:
   * a GIF tab that shows nothing looks like "no results", and the difference
   * between that and "the service is misconfigured" is the whole point.
   */
  async gifs(query: string): Promise<{ gifs: any[]; error?: string }> {
    try {
      const { gifs } = await api.get<{ gifs: any[] }>(`/api/search/gifs?q=${encodeURIComponent(query)}`);
      return { gifs };
    } catch (err) {
      console.error("GIF search failed:", err);
      const status = err instanceof ApiError ? err.detail?.status : undefined;
      const message = err instanceof Error ? err.message : "GIF search failed.";
      return { gifs: [], error: status ? `${message} (upstream ${status})` : message };
    }
  },

  async images(query: string): Promise<any[]> {
    try {
      const { photos } = await api.get<{ photos: any[] }>(`/api/search/images?q=${encodeURIComponent(query)}`);
      return photos;
    } catch (err) {
      console.error("Image search failed:", err);
      return [];
    }
  },

  async linkPreview(url: string): Promise<{ url: string; title?: string; description?: string; image?: string } | null> {
    try {
      const { preview } = await api.get<{ preview: any }>(`/api/search/link-preview?url=${encodeURIComponent(url)}`);
      return preview;
    } catch {
      return null;
    }
  },
};

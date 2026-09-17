/**
 * Object storage for the pictures and videos people put on a wall.
 *
 * Under Supabase these were base64 data URLs living in a text column, which
 * made every poll of a wall re-download every image on it. They are R2 objects
 * now; the database keeps a path.
 */

import { currentEnv } from "./context";

export interface StoragePutOptions {
  contentType?: string;
}

export interface StorageObject {
  key: string;
  /** The size of the whole object, not of the slice returned. */
  size: number;
  contentType?: string;
  body: ReadableStream | null;
  httpEtag: string;
  /** Present when a byte range was asked for and R2 returned that slice. */
  range?: { offset: number; length: number };
  arrayBuffer(): Promise<ArrayBuffer>;
}

const bucket = () => currentEnv().BUCKET;

export const storage = {
  /**
   * Fetch an object, optionally one slice of it.
   *
   * The range matters for video. A `<video>` element asks for byte ranges, and
   * Safari in particular will refuse to play a source that answers a range
   * request with the whole file — which, on an app used from classroom iPads,
   * means recorded video simply doesn't play.
   */
  async get(key: string, range?: { offset: number; length?: number }): Promise<StorageObject | null> {
    const obj = await bucket().get(key, range ? { range } : undefined);
    if (!obj) return null;
    const got = (obj as unknown as { range?: { offset: number; length: number } }).range;
    return {
      key,
      size: obj.size,
      contentType: obj.httpMetadata?.contentType,
      body: obj.body,
      httpEtag: obj.httpEtag,
      range: got,
      arrayBuffer: () => obj.arrayBuffer(),
    };
  },

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options: StoragePutOptions = {},
  ): Promise<void> {
    await bucket().put(key, value as ArrayBuffer, {
      httpMetadata: options.contentType ? { contentType: options.contentType } : undefined,
    });
  },

  /**
   * Delete everything under a prefix, following the cursor to the end.
   *
   * Deleting a wall has to sweep the wall's media, and a sweep that stops after
   * the first page leaves objects behind that nothing will ever point at again.
   * R2 takes up to a thousand keys per delete call, so it goes in batches.
   */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let cursor: string | undefined;
    do {
      const page = await bucket().list({ prefix, cursor });
      const keys = page.objects.map((o) => o.key);
      for (let i = 0; i < keys.length; i += 1000) {
        await bucket().delete(keys.slice(i, i + 1000));
      }
      deleted += keys.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return deleted;
  },
};

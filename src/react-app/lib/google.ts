/**
 * Browser-side Google.
 *
 * The client id was a string literal repeated in three components; it comes
 * from the server now (`/api/auth/google/config`), so the deployment decides it
 * rather than a constant someone has to remember to change in three places. It
 * is still public — a client id appears in the page source of every site that
 * offers Google sign-in — but the Worker is the one place that says what it is.
 *
 * Classroom and Drive are still called straight from here with the teacher's
 * own token. That is deliberate: it means the server never holds Google API
 * credentials, and a student is never asked for Classroom scopes.
 */

export const SIGN_IN_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.announcements",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

declare global {
  interface Window {
    google?: any;
  }
}

let configPromise: Promise<{ enabled: boolean; clientId: string }> | null = null;

export function googleConfig(): Promise<{ enabled: boolean; clientId: string }> {
  configPromise ??= fetch("/api/auth/google/config", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { enabled: false, clientId: "" }))
    .catch(() => ({ enabled: false, clientId: "" }));
  return configPromise;
}

let scriptPromise: Promise<void> | null = null;

/**
 * Load Google's client script on demand.
 *
 * It used to be a `<script>` tag in index.html, which every visitor paid for
 * whether or not they ever signed in — including the class that arrives through
 * a join link and never touches Google at all.
 */
export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google's sign-in script")));
      return;
    }
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client";
    el.async = true;
    el.defer = true;
    el.dataset.gis = "1";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Failed to load Google's sign-in script"));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

/** A token client for a scope set, once the script and the client id are both ready. */
export async function tokenClient(
  scope: string,
  onToken: (accessToken: string) => void,
  onError?: (message: string) => void,
): Promise<TokenClient | null> {
  const { enabled, clientId } = await googleConfig();
  if (!enabled) {
    onError?.("Google sign-in isn't configured for this deployment.");
    return null;
  }
  await loadGoogleScript();

  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    callback: (response: any) => {
      if (response?.error) {
        onError?.(response.error_description || response.error);
        return;
      }
      onToken(response.access_token);
    },
    error_callback: (err: any) => onError?.(err?.message ?? "Google authorization was canceled."),
  });
}

/** The token the browser holds for Classroom and Drive. Never sent to our server to keep. */
export const storedAccessToken = () => sessionStorage.getItem("google_access_token");
export const storeAccessToken = (token: string) => sessionStorage.setItem("google_access_token", token);
export const clearAccessToken = () => sessionStorage.removeItem("google_access_token");

/**
 * Signing in.
 *
 * The old flow asked Google for an access token in the browser, fetched the
 * profile with it, and then told the app "I am this person" — a claim nothing
 * ever checked. Anyone could edit the localStorage blob and become any teacher.
 *
 * Now the browser sends proof, and the Worker checks it before minting a
 * session. There is still no client secret anywhere in the system: both proofs
 * are things Google issued and vouches for, rather than something exchanged for
 * an identity, so there is nothing new to store or rotate.
 *
 * Two proofs are accepted because Wallama asks for Classroom access in the same
 * click as signing in, and that flow yields an access token rather than an ID
 * token. Splitting them would mean two consent prompts for one button.
 *
 *   - An **ID token** is a JWT Google signed; its signature is verified here
 *     against Google's published keys. This is the stronger primitive and the
 *     one to use if a plain sign-in button is ever added.
 *   - An **access token** is opaque, so it is verified by asking Google about
 *     it. The `aud` check in that answer is the part that matters: without it,
 *     a token some other app was granted would sign its holder in here as
 *     whoever the token belongs to.
 */

import { app, db } from "../platform";
import {
  HttpError,
  handler,
  currentUser,
  endSession,
  startSession,
  now,
  uid,
  type AppUser,
} from "../lib/session";

interface GoogleClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

const b64url = (s: string) => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function verifyGoogleIdToken(token: string, clientId: string): Promise<GoogleClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "That Google sign-in couldn't be read.");

  const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new HttpError(401, "Unexpected Google token algorithm.");

  const jwks = await fetch(GOOGLE_JWKS).then((r) => r.json() as Promise<{ keys: (JsonWebKey & { kid: string })[] }>);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Google signed that token with a key we don't recognize.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), signed);
  if (!valid) throw new HttpError(401, "That Google sign-in failed verification.");

  const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as GoogleClaims;

  // A valid signature only says Google issued it. These say it was issued to
  // us, recently, for a real address. Skipping `aud` in particular would let a
  // token minted for any other Google app sign someone in here.
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new HttpError(401, "That token didn't come from Google.");
  if (claims.aud !== clientId) throw new HttpError(401, "That Google sign-in was issued for a different app.");
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, "That Google sign-in has expired — try again.");
  if (!claims.sub) throw new HttpError(401, "That Google account has no subject id.");
  if (claims.email_verified === false || claims.email_verified === "false") {
    throw new HttpError(401, "That Google account's email isn't verified.");
  }
  return claims;
}

/**
 * Verify an opaque access token by asking Google what it is.
 *
 * `tokeninfo` answers with the token's audience, subject, scopes and expiry.
 * The audience check is the whole point: a valid Google access token proves
 * someone granted *some* app access to their account, and without confirming it
 * was this one, a token obtained by any other site could be replayed here to
 * sign in as its owner.
 *
 * The profile then comes from `userinfo`, which is the same endpoint the old
 * browser code called — the difference being that the answer now arrives at the
 * server that is going to act on it rather than at a client that could edit it.
 */
async function verifyGoogleAccessToken(token: string, clientId: string): Promise<GoogleClaims> {
  const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!infoRes.ok) throw new HttpError(401, "That Google sign-in couldn't be verified — try again.");
  const info = (await infoRes.json()) as {
    aud?: string;
    sub?: string;
    exp?: string;
    email?: string;
    email_verified?: string;
  };

  if (info.aud !== clientId) throw new HttpError(401, "That Google sign-in was issued for a different app.");
  if (!info.sub) throw new HttpError(401, "That Google account has no subject id.");
  if (info.exp && Number(info.exp) * 1000 < Date.now()) {
    throw new HttpError(401, "That Google sign-in has expired — try again.");
  }
  if (info.email_verified === "false") throw new HttpError(401, "That Google account's email isn't verified.");

  // Name and picture aren't in the tokeninfo response, so the profile is a
  // second call. A failure here isn't fatal: the email is the identity, and a
  // missing display name is a cosmetic problem.
  let profile: { name?: string; picture?: string; email?: string } = {};
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (profileRes.ok) profile = await profileRes.json();
  } catch {
    /* cosmetic only */
  }

  return {
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: info.sub,
    exp: Number(info.exp ?? 0),
    email: info.email ?? profile.email,
    email_verified: info.email_verified !== "false",
    name: profile.name,
    picture: profile.picture,
  };
}

/**
 * Teacher or student?
 *
 * Wallama has always answered this by asking Google Classroom whether you teach
 * anything, and that is still the right question — it just can't be the
 * browser's answer to give, since the role decides who may create and delete
 * walls. The client passes along the access token it already holds for
 * Classroom, and the Worker makes the call itself. The token is used for this
 * one request and never stored.
 *
 * Anything other than a clear yes means student: a refused scope or a Classroom
 * outage should not hand out teacher rights.
 */
async function looksLikeTeacher(accessToken: string | undefined): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch("https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { courses?: unknown[] };
    return Array.isArray(data.courses) && data.courses.length > 0;
  } catch {
    return false;
  }
}

app.post(
  "/api/auth/google",
  handler(async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID ?? "";
    if (!clientId) throw new HttpError(503, "Google sign-in isn't configured for this deployment.");

    const { credential, accessToken } = await c.req.json<{ credential?: string; accessToken?: string }>();
    if (!credential && !accessToken) throw new HttpError(400, "No Google credential was sent.");

    const claims = credential
      ? await verifyGoogleIdToken(credential, clientId)
      : await verifyGoogleAccessToken(accessToken!, clientId);
    const email = claims.email?.toLowerCase() ?? null;
    const name = claims.name?.trim() || email || "Teacher";

    const existing = await db
      .prepare(`SELECT * FROM users WHERE google_sub = ?`)
      .bind(claims.sub)
      .first<AppUser>();

    // Re-checked on every sign-in rather than fixed at first sight: someone who
    // was a student last September may be teaching this one.
    const role = (await looksLikeTeacher(accessToken)) ? "teacher" : "student";

    let user: AppUser;
    if (existing) {
      await db
        .prepare(`UPDATE users SET email = ?, name = ?, avatar = ?, role = ?, last_seen_at = ? WHERE id = ?`)
        .bind(email, name, claims.picture ?? null, role, now(), existing.id)
        .run();
      user = { ...existing, email, name, avatar: claims.picture ?? null, role };
    } else {
      const id = uid();
      await db
        .prepare(
          `INSERT INTO users (id, google_sub, email, name, avatar, role, is_guest, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(id, claims.sub, email, name, claims.picture ?? null, role, now(), now())
        .run();
      user = { id, google_sub: claims.sub, email, name, avatar: claims.picture ?? null, role, is_guest: 0 };
    }

    await startSession(c, user.id);
    return c.json({ user: publicUser(user) });
  }),
);

/**
 * A guest identity, for someone opening a shared link without signing in.
 *
 * This used to be a random id the browser made up for itself. It is a real row
 * now, for one reason that matters: a post's author is whoever the Worker says
 * is making the request, so a guest needs to be someone the Worker knows about
 * before they can be the author of anything.
 */
app.post(
  "/api/auth/guest",
  handler(async (c) => {
    const existing = await currentUser(c);
    if (existing) return c.json({ user: publicUser(existing) });

    const id = uid();
    const name = "Guest Contributor";
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`;
    await db
      .prepare(
        `INSERT INTO users (id, google_sub, email, name, avatar, role, is_guest, created_at, last_seen_at)
         VALUES (?, NULL, NULL, ?, ?, 'student', 1, ?, ?)`,
      )
      .bind(id, name, avatar, now(), now())
      .run();

    await startSession(c, id);
    return c.json({ user: { id, name, email: "", role: "student", avatar, isGuest: true } });
  }),
);

app.post(
  "/api/auth/leave",
  handler(async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  }),
);

/** Who am I? Null (200) when signed out, so the client can show the sign-in page. */
app.get(
  "/api/me",
  handler(async (c) => {
    const user = await currentUser(c);
    return c.json({ user: user ? publicUser(user) : null });
  }),
);

/** Whether the sign-in screen should offer the Google button, and with what id. */
app.get(
  "/api/auth/google/config",
  handler(async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID ?? "";
    return c.json({ enabled: !!clientId, clientId });
  }),
);

export function publicUser(user: AppUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? "",
    role: user.role,
    avatar: user.avatar ?? undefined,
    isGuest: !!user.is_guest,
  };
}

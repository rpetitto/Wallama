/**
 * Teacher or student — and, when the answer is student, why.
 *
 * Wallama has always answered this by asking Google Classroom whether you teach
 * anything. It used to keep only the yes or no, so a teacher who landed as a
 * student had no way to find out what went wrong: the wrong Google account,
 * archived classes, an unticked permission, and a school admin blocking the
 * Classroom API all looked the same. This keeps the reason, for the sign-in
 * screen to show.
 *
 * Anything other than a clear yes still means student. A refused permission or
 * a Classroom outage must not hand out teacher rights; it only gets explained.
 */

import type { RoleCheck, UncheckedReason } from "../../shared/roleCheck";

export const COURSES_SCOPE = "https://www.googleapis.com/auth/classroom.courses.readonly";

type Fetch = typeof fetch;

/**
 * Why Classroom refused a request, from the error body Google sends.
 *
 * Google's errors carry a machine-readable reason in `details`, and Classroom
 * puts its own codes at the front of the message (`@ClassroomApiDisabled`).
 * Anything unrecognised is passed through in Google's words, trimmed, since
 * a message nobody has mapped is still better than "something went wrong".
 */
async function refusal(res: Response): Promise<{ reason: UncheckedReason; googleMessage?: string }> {
  if (res.status >= 500) return { reason: "unreachable" };

  let message = "";
  const reasons: string[] = [];
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string; details?: { reason?: string }[] };
    };
    message = body.error?.message ?? "";
    for (const d of body.error?.details ?? []) if (d?.reason) reasons.push(d.reason);
  } catch {
    // Not JSON. The status code is all there is.
  }

  if (message.includes("ClassroomApiDisabled")) return { reason: "admin_blocked" };
  if (reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient (authentication )?scopes/i.test(message)) {
    return { reason: "no_permission" };
  }
  if (reasons.includes("SERVICE_DISABLED") || /has not been used in project|is disabled/i.test(message)) {
    return { reason: "api_off" };
  }
  const trimmed = message.replace(/\s+/g, " ").trim();
  return {
    reason: "google_error",
    googleMessage: trimmed ? (trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed) : `HTTP ${res.status}`,
  };
}

/** Does Classroom list an active class with this person in this position? */
async function hasActiveClass(
  accessToken: string,
  as: "teacherId" | "studentId",
  fetchImpl: Fetch,
): Promise<boolean | RoleCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`https://classroom.googleapis.com/v1/courses?${as}=me&courseStates=ACTIVE&pageSize=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { result: "unchecked", reason: "unreachable" };
  }
  if (!res.ok) return { result: "unchecked", ...(await refusal(res)) };
  const data = (await res.json().catch(() => ({}))) as { courses?: unknown[] };
  return Array.isArray(data.courses) && data.courses.length > 0;
}

/**
 * Ask Classroom who this is.
 *
 * `grantedScopes` comes from Google's tokeninfo. When the Classroom scope isn't
 * in it, the person unticked it on the consent screen, and saying so beats
 * asking Classroom and decoding the refusal.
 *
 * A second question — "are you taking any classes?" — is asked only when the
 * first comes back empty. It is what keeps the sign-in screen quiet for the
 * students it has always waved through, while still stopping for an account
 * with no classes at all, which is what a teacher on the wrong account, or
 * with every class archived, looks like.
 */
export async function checkRole(
  accessToken: string | undefined,
  grantedScopes: string | undefined,
  fetchImpl: Fetch = fetch,
): Promise<RoleCheck> {
  // An ID-token sign-in carries no Classroom access at all.
  if (!accessToken) return { result: "unchecked", reason: "no_permission" };
  if (grantedScopes !== undefined && !grantedScopes.split(/\s+/).includes(COURSES_SCOPE)) {
    return { result: "unchecked", reason: "no_permission" };
  }

  const teaches = await hasActiveClass(accessToken, "teacherId", fetchImpl);
  if (teaches === true) return { result: "teacher" };
  if (teaches !== false) return teaches;

  // Whether they teach is settled. If the enrolment question fails, explain the
  // empty account rather than claim the check itself couldn't run.
  const takes = await hasActiveClass(accessToken, "studentId", fetchImpl);
  return takes === true ? { result: "student" } : { result: "no_classes" };
}

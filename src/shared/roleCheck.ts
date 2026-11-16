/**
 * What signing in found out about whether someone teaches.
 *
 * Shared by the Worker, which decides it, and the sign-in screen, which
 * explains it. Anything but "teacher" signs the person in as a student; the
 * last two are the cases where that might be wrong, so the screen stops to say
 * why before carrying on.
 */
export type RoleCheck =
  /** Teaches at least one active class. */
  | { result: "teacher" }
  /** Teaches none, but is enrolled in one: an ordinary student, nothing to explain. */
  | { result: "student" }
  /** Neither teaches nor takes an active class on this account. */
  | { result: "no_classes" }
  /** Google wouldn't answer, so whether they teach is unknown. */
  | { result: "unchecked"; reason: UncheckedReason; googleMessage?: string };

export type UncheckedReason =
  /** The Classroom permission was unticked on Google's consent screen. */
  | "no_permission"
  /** The school's Google admin has turned off Classroom data access for apps. */
  | "admin_blocked"
  /** The Classroom API is switched off on Wallama's own Google Cloud project. */
  | "api_off"
  /** Google refused for some other reason; `googleMessage` has its words. */
  | "google_error"
  /** Classroom didn't answer at all. */
  | "unreachable";

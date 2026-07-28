/**
 * Validation for a sandbox's name.
 *
 * Node-free so the create dialogs can check before submitting and the API can
 * check again — the API is the one that matters, since the name becomes three
 * things at once: a directory under `data/sandboxes/`, a path segment in
 * `/sandbox/<name>`, and (for agent-assist) part of an agent name and a room
 * name. A name that is fine for one of those and not the others fails somewhere
 * far from where it was typed.
 */

export const SANDBOX_NAME_MAX = 48;

/**
 * Lowercase letters, digits, dashes and underscores; must start and end with a
 * letter or digit. Deliberately narrow: `.` and `/` would escape the sandboxes
 * directory, spaces break the URL, and uppercase collides with itself on a
 * case-insensitive filesystem.
 */
export const SANDBOX_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export const SANDBOX_NAME_RULE =
  "Use lowercase letters, numbers, dashes and underscores, starting and ending with a letter or number.";

/** Null when the name is usable, otherwise a sentence to show the user. */
export function validateSandboxName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Give the sandbox a name.";
  if (name.length > SANDBOX_NAME_MAX) {
    return `That name is too long — keep it under ${SANDBOX_NAME_MAX} characters.`;
  }
  if (name !== name.toLowerCase()) {
    return `Sandbox names are lowercase. Try "${name.toLowerCase()}".`;
  }
  if (!SANDBOX_NAME_PATTERN.test(name)) return SANDBOX_NAME_RULE;
  return null;
}

/**
 * Compares two sandbox names the way the filesystem will. macOS is
 * case-insensitive, so `Support` and `support` are one directory there and two
 * rows in the database — a collision that only shows up on someone else's laptop.
 */
export function sameSandboxName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Usernames are the credential people type. Auth itself always needs an email
 * address, so a username is mapped to a deterministic internal address that
 * never receives mail. Anyone who signed up with a real email keeps using it.
 */
export const USERNAME_DOMAIN = "ddigitize.local";

export function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

export function isUsernameValid(value: string): boolean {
  const normalized = normalizeUsername(value);
  return normalized.length >= 3 && normalized.length <= 40;
}

export function usernameToEmail(value: string): string {
  return `${normalizeUsername(value)}@${USERNAME_DOMAIN}`;
}

/** Accept either a username or a real email in the sign-in field. */
export function loginIdentifierToEmail(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : usernameToEmail(trimmed);
}

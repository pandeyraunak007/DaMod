// Names must be valid unquoted Postgres identifiers (FR-2.6): letters, digits and
// underscore, not starting with a digit, at most 63 characters. This is a hard
// gate on renames (AT-1.2) — an invalid name is rejected and the old one kept.
//
// Duplicate names (FR-2.5) are a *soft* error handled elsewhere: they are flagged
// but never block the edit or a save.

export const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Returns an error message if the name is not a valid unquoted Postgres
 * identifier, or null if it is valid.
 */
export function validateIdentifier(name: string): string | null {
  if (name.length === 0) return "Name cannot be empty";
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    return `Name must be at most ${MAX_IDENTIFIER_LENGTH} characters`;
  }
  if (/^[0-9]/.test(name)) return "Name cannot start with a digit";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use only letters, digits and underscore (no spaces)";
  }
  return null;
}

export function isValidIdentifier(name: string): boolean {
  return validateIdentifier(name) === null;
}

/**
 * Turn an arbitrary label into an identifier-safe snake_case token. Used to
 * suggest foreign-key field and junction names, never to silently rewrite a
 * name the author typed.
 */
export function toSnakeCase(label: string): string {
  const cleaned = label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (cleaned.length === 0) return "field";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

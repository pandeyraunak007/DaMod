// Stable random IDs (FR-5.2). Every entity, field, relationship, link, term,
// dimension, metric and model gets one of these. Names are display values and
// can change freely; references always use these IDs.
//
// Format (from the Model file format section): a type prefix plus 8 random
// characters, e.g. `e_a1b2c3d4`. The alphabet is lowercase base36 to match the
// examples in the spec and to stay identifier-safe.

export const ID_PREFIXES = {
  model: "m_",
  entity: "e_",
  field: "f_",
  relationship: "r_",
  link: "l_",
  conceptGroup: "c_",
  term: "t_",
  dimension: "d_",
  metric: "k_",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const RANDOM_LENGTH = 8;

/** 8 random base36 characters, drawn from a cryptographic source. */
function randomSuffix(): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Generate a fresh ID for the given kind, e.g. `newId("entity") -> "e_a1b2c3d4"`. */
export function newId(kind: IdKind): string {
  return ID_PREFIXES[kind] + randomSuffix();
}

const ID_PATTERN = new RegExp(`^(m|e|f|r|l|c|t|d|k)_[0-9a-z]{${RANDOM_LENGTH}}$`);

/** True when a string is a well-formed DaMod ID of any kind. */
export function isId(value: string): boolean {
  return ID_PATTERN.test(value);
}

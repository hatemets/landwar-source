import { base64url } from "jose";

/**
 * Converts a base64url-encoded binary UUID back to its canonical UUID string.
 * @param encoded - base64url string (e.g., 'Ej5FZ+i7EtOkVkJmFBdAAA')
 * @returns UUID string (e.g., '123e4567-e89b-12d3-a456-426614174000')
 */
export function base64urlToUuid(encoded: string): string {
  const bytes = base64url.decode(encoded);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

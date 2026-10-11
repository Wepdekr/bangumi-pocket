import { decodeHTMLStrict } from "entities";

/** Decode one layer of complete HTML entities at the display boundary only.
 * Keep API responses, URLs, identifiers, stored data and editable inputs raw.
 * Render the result as React text, never as HTML. No repeated decoding.
 */
export function displayText(value: string | null | undefined): string {
  return value?.includes("&") ? decodeHTMLStrict(value) : (value ?? "");
}

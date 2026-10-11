// Legacy calendar responses still contain HTTP URLs; Android uses HTTPS.
export function imageUrl(source?: string) {
  if (!source) return undefined;
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = "https:";
    return url.href;
  } catch {
    return undefined;
  }
}

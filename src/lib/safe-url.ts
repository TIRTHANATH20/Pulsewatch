// Only http(s) URLs may be rendered as links. Article URLs come from the
// news corpus (data we do not control), and `javascript:` / `data:` URLs in
// an href would execute in the app's origin when clicked.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

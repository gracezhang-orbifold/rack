// A label's QR encodes a URL like https://host/scan/RACK-0012, but people may
// also type the printed asset id by hand — accept either.
export function parseAssetId(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/\/scan\/([^/?#]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  if (t.includes("/")) return null; // some other URL — not one of our labels
  return t;
}

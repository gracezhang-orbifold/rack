// Labels now encode the bare asset id (small 21×21 QRs); older printed labels
// encode a URL like https://host/scan/RACK-0012, and people may also type the
// id by hand — accept all three.
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

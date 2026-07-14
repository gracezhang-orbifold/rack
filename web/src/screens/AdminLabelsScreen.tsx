import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { useAdminInventory, useAssignAssetIds } from "../hooks/queries";
import { Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

// SVG (not canvas) so labels print crisply at any size; rendered through an
// <img> data URL so no markup is ever injected into the document.
function QrSvg({ value }: { value: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "H" })
      .then((s) => { if (alive) setSrc(`data:image/svg+xml,${encodeURIComponent(s)}`); })
      .catch(() => { if (alive) setSrc(""); });
    return () => { alive = false; };
  }, [value]);
  if (!src) return <div className="h-11 w-11" />; // reserve space while the SVG renders
  return <img src={src} alt={`QR code for ${value}`} className="h-11 w-11" />;
}

// Printable QR labels, one per unit with an asset id. The QR encodes just the
// asset id (not a URL): that keeps every code at 21×21 modules with H-level
// error correction, so labels stay scannable even printed ~1cm for small
// items. Scanning happens in the app (Browse → Scan label), which routes to
// /scan/<asset_id>; old URL-encoding labels still parse (lib/scan.ts).
type SortBy = "category" | "name" | "added" | "number";

// Trailing number for asset-id sorting (RACK-0012 → 12); non-numeric ids sink.
const assetNum = (id: string) => {
  const m = id.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Infinity;
};

export function AdminLabelsScreen() {
  const inventory = useAdminInventory();
  const assign = useAssignAssetIds();
  const toast = useToast();
  // Which labels print. Tap a label to toggle it; deselected ones dim on
  // screen and are excluded from the printout. Default: everything selected.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>("category");

  if (inventory.isLoading) return <Spinner />;
  if (inventory.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load inventory.</p>;

  // API order is category → item name → unit created_at; that's the
  // "category" sort. The others re-sort the flat list.
  const units = inventory.data!.flatMap((t) =>
    t.units.filter((u) => u.asset_id && u.status !== "retired")
      .map((u) => ({ asset_id: u.asset_id!, name: t.name, created_at: u.created_at })));
  if (sortBy === "name") units.sort((a, b) => a.name.localeCompare(b.name) || assetNum(a.asset_id) - assetNum(b.asset_id));
  else if (sortBy === "added") units.sort((a, b) => a.created_at.localeCompare(b.created_at));
  else if (sortBy === "number") units.sort((a, b) => assetNum(a.asset_id) - assetNum(b.asset_id) || a.asset_id.localeCompare(b.asset_id));
  const unlabeled = inventory.data!.reduce(
    (n, t) => n + t.units.filter((u) => !u.asset_id && u.status !== "retired").length, 0);
  const selectedCount = units.filter((u) => !deselected.has(u.asset_id)).length;

  const toggle = (assetId: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });

  return (
    <div className="py-3">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold">QR labels</h2>
        <Link to="/admin/inventory" className="text-sm text-gray-500 underline">Inventory</Link>
      </div>

      <div className="mb-4 flex flex-col gap-2 print:hidden">
        {unlabeled > 0 && (
          <Button variant="secondary" disabled={assign.isPending}
            onClick={() => assign.mutate(undefined, {
              onSuccess: (r) => toast(`Assigned asset IDs to ${r.assigned} unit${r.assigned === 1 ? "" : "s"}.`),
              onError: (e) => toast(errorMessage(e), "error"),
            })}>
            {assign.isPending ? "Assigning…" : `Assign asset IDs to ${unlabeled} unlabeled unit${unlabeled === 1 ? "" : "s"}`}
          </Button>
        )}
        <Button disabled={selectedCount === 0} onClick={() => window.print()}>
          Print {selectedCount} label{selectedCount === 1 ? "" : "s"}
        </Button>
        {units.length > 0 && (
          <label className="flex items-center justify-between text-sm text-gray-600">
            Sort by
            <select className="rounded-lg border border-gray-300 px-2 py-1"
              value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="category">Category</option>
              <option value="name">Item name</option>
              <option value="added">Date added</option>
              <option value="number">Asset number</option>
            </select>
          </label>
        )}
        {units.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">{selectedCount}/{units.length} selected — tap labels to toggle</span>
            {selectedCount < units.length
              ? <button className="text-gray-500 underline" onClick={() => setDeselected(new Set())}>Select all</button>
              : <button className="text-gray-500 underline" onClick={() => setDeselected(new Set(units.map((u) => u.asset_id)))}>Clear</button>}
          </div>
        )}
        <p className="text-xs text-gray-500">
          Print, cut along the dashed lines, and tape each label to its item.
          Scan a label from Browse → Scan label to check out that exact unit.
        </p>
      </div>

      {units.length === 0 ? (
        <p className="text-sm text-gray-500">No units have asset IDs yet.</p>
      ) : (
        // Print is a fixed 12-per-row grid; on screen the labels just wrap.
        <ul className="flex flex-wrap gap-2 print:grid print:grid-cols-12 print:gap-1">
          {units.map((u) => {
            const off = deselected.has(u.asset_id);
            return (
              <li key={u.asset_id} onClick={() => toggle(u.asset_id)} aria-selected={!off}
                className={`flex w-[60px] cursor-pointer break-inside-avoid flex-col items-center gap-0.5 border border-dashed p-0.5 text-center print:w-auto ${off ? "border-gray-200 opacity-40 print:hidden" : "border-gray-400"}`}>
                <QrSvg value={u.asset_id} />
                <p className="whitespace-nowrap font-mono text-[9px] font-bold leading-none">{u.asset_id}</p>
                <p className="text-[9px] leading-tight text-gray-600">{u.name}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAvailability, useBorrow, useConfirmBorrow } from "../hooks/queries";
import { filterInventory, groupByCategory } from "../lib/filter";
import { borrowResultMessage, errorMessage } from "../lib/borrowResult";
import { parseAssetId } from "../lib/scan";
import { Badge, Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { RequestOptions } from "../components/RequestOptions";
import { QrScanner } from "../components/QrScanner";
import { LastReturnNotice } from "../components/LastReturnNotice";
import { ApiError } from "../lib/api";
import type { AvailabilityItem, BorrowResult } from "../lib/types";

const DAY_PRESETS = [1, 3, 7, 14];

// Stock at a glance: one pip per unit, lit while available. Decorative —
// the "N/N available" badge carries the same information as text.
function AvailabilityPips({ available, total }: { available: number; total: number }) {
  if (total === 0 || total > 8) return null;
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full transition-colors ${i < available ? "bg-primary" : "bg-text/15"}`} />
      ))}
    </span>
  );
}

export function BrowseScreen() {
  const availability = useAvailability();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<BorrowResult | null>(null);
  const [confirmedAsset, setConfirmedAsset] = useState<string | null>(null);
  const [confirmedKitAsset, setConfirmedKitAsset] = useState<string | null>(null);
  const [withKit, setWithKit] = useState(true);
  const [manualId, setManualId] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [labelScan, setLabelScan] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [labelScanKey, setLabelScanKey] = useState(0);
  const [labelScanError, setLabelScanError] = useState<string | null>(null);
  const borrow = useBorrow();
  const confirmUnit = useConfirmBorrow();
  const toast = useToast();
  const navigate = useNavigate();

  // Scan a printed label to jump to that unit's checkout page. Labels encode
  // the bare asset id; older ones encode a /scan/ URL — parseAssetId takes both.
  const goToLabel = (text: string) => {
    const assetId = parseAssetId(text);
    if (!assetId) {
      setLabelScanError("That doesn't look like a Rack label — try again or type the ID.");
      setLabelScanKey((k) => k + 1);
      return;
    }
    navigate(`/scan/${encodeURIComponent(assetId)}`);
  };

  const openSheet = (item: AvailabilityItem) => {
    setSelected(item); setDays(7); setResult(null);
    setConfirmedAsset(null); setManualId(""); setScanError(null);
    setConfirmedKitAsset(null); setWithKit(true);
    borrow.reset(); confirmUnit.reset();
  };
  const closeSheet = () => { setSelected(null); setResult(null); setConfirmedAsset(null); setConfirmedKitAsset(null); };

  const kitOffer = selected?.accessory && selected.accessory.available_units > 0 ? selected.accessory : null;
  const kitSession = result?.accessory && "session_id" in result.accessory ? result.accessory : null;
  const kitError = result?.accessory && "error" in result.accessory ? result.accessory.error : null;
  // Which session the next scanned label confirms: camera first, then the kit.
  const pendingSession = result && !confirmedAsset ? result.session_id
    : kitSession && !confirmedKitAsset ? kitSession.session_id : null;

  const confirmAsset = (assetId: string) => {
    if (!pendingSession) return;
    confirmUnit.mutate({ session_id: pendingSession, asset_id: assetId }, {
      onSuccess: (r) => {
        if (!confirmedAsset) setConfirmedAsset(r.asset_id);
        else setConfirmedKitAsset(r.asset_id);
        setManualId(""); setScanError(null); setScanKey((k) => k + 1);
      },
      onError: (e) => {
        setScanError(e instanceof ApiError ? e.message : errorMessage(e));
        setScanKey((k) => k + 1); // remount the scanner so they can rescan
      },
    });
  };
  const onDecoded = (text: string) => {
    const assetId = parseAssetId(text);
    if (!assetId) {
      setScanError("That doesn't look like a Rack label — try again or type the ID.");
      setScanKey((k) => k + 1);
      return;
    }
    setScanError(null);
    confirmAsset(assetId);
  };

  const confirm = () => {
    if (!selected) return;
    borrow.mutate({ item_type_id: selected.item_type_id, days,
      with_accessory: kitOffer && withKit ? true : undefined }, {
      onSuccess: (r) => setResult(r),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) { toast(errorMessage(e)); closeSheet(); }
      },
    });
  };

  if (availability.isLoading) return <Spinner />;
  if (availability.isError) return <p className="p-4 text-sm text-muted">Couldn't load inventory. Pull to refresh.</p>;

  const groups = groupByCategory(filterInventory(availability.data ?? [], q));

  return (
    <div className="pb-4">
      <div className="my-3 flex gap-2">
        <Input placeholder="Search equipment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => { setLabelScan((s) => !s); setLabelId(""); setLabelScanError(null); }}>
          Scan label
        </Button>
      </div>
      {labelScan && (
        <div className="mb-3 rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
          <QrScanner key={labelScanKey} onScan={goToLabel} />
          <div className="mt-3 flex gap-2">
            <Input placeholder="…or type the asset ID" value={labelId}
              onChange={(e) => setLabelId(e.target.value)} />
            <Button variant="secondary" disabled={!parseAssetId(labelId)}
              onClick={() => goToLabel(labelId)}>
              Go
            </Button>
          </div>
          {labelScanError && <p className="mt-2 text-sm text-danger">{labelScanError}</p>}
        </div>
      )}
      {groups.length === 0 && <p className="mt-8 text-center text-sm text-muted">No matches.</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="mb-5 animate-fade-up">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted/70">{category}</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.item_type_id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={item.available_units > 0 ? "green" : "gray"}>{item.available_units}/{item.total_units} available</Badge>
                    <AvailabilityPips available={item.available_units} total={item.total_units} />
                  </div>
                </div>
                {item.available_units > 0
                  ? <Button onClick={() => openSheet(item)}>Borrow</Button>
                  : <Button variant="secondary" onClick={() => openSheet(item)}>Options</Button>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Sheet open={selected !== null} onClose={closeSheet}>
        {result && confirmedAsset && (!kitSession || confirmedKitAsset) ? (
          <div className="text-center">
            <h3 className="mb-1 text-lg font-semibold">All set</h3>
            <LastReturnNotice lastReturn={result.last_return} />
            <p className="mb-5 text-sm text-muted">
              <span className="font-mono">{confirmedAsset}</span>
              {confirmedKitAsset ? <> and <span className="font-mono">{confirmedKitAsset}</span> are checked out to you.</> : <> is checked out to you.</>} Close the door when you're done.
            </p>
            <Button className="w-full" onClick={closeSheet}>Done</Button>
          </div>
        ) : result ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{borrowResultMessage(result).title}</h3>
            <LastReturnNotice lastReturn={result.last_return} />
            <p className="mb-3 text-sm text-muted">
              {!confirmedAsset
                ? "Take your item, then scan the QR label on it to confirm which one you took."
                : "Now scan the accessory box label."}
            </p>
            {kitError && <p className="mb-3 text-sm text-warning">{kitError}</p>}
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <Input placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || confirmUnit.isPending}
                onClick={() => confirmAsset(parseAssetId(manualId)!)}>
                {confirmUnit.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-danger">{scanError}</p>}
            <button className="mt-4 w-full text-center text-xs text-muted/70 underline" onClick={closeSheet}>
              Can't scan right now? Confirm later from My Items — borrowing is paused until you do
            </button>
          </div>
        ) : selected && selected.available_units === 0 ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{selected.name} is unavailable</h3>
            <p className="mb-4 text-sm text-muted">All units are out. You can:</p>
            <RequestOptions itemTypeId={selected.item_type_id} itemName={selected.name} />
          </div>
        ) : selected ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Borrow {selected.name}</h3>
            <p className="mb-4 text-sm text-muted">How long do you need it?</p>
            <div className="mb-4 flex gap-2">
              {DAY_PRESETS.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
                  {d}d
                </button>
              ))}
            </div>
            {kitOffer && (
              <label className="mb-4 flex items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-4 w-4" checked={withKit}
                  onChange={(e) => setWithKit(e.target.checked)} />
                Also take an accessory kit ({kitOffer.available_units} available)
              </label>
            )}
            {borrow.isError && <p className="mb-3 text-sm text-danger">{errorMessage(borrow.error)}</p>}
            <Button className="w-full" disabled={borrow.isPending} onClick={confirm}>
              {borrow.isPending ? "Unlocking…" : "Confirm & unlock"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

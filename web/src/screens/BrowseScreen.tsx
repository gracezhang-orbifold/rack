import { useState } from "react";
import { useAvailability, useBorrow, useConfirmBorrow } from "../hooks/queries";
import { filterInventory, groupByCategory } from "../lib/filter";
import { borrowResultMessage, errorMessage } from "../lib/borrowResult";
import { parseAssetId } from "../lib/scan";
import { Badge, Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { RequestOptions } from "../components/RequestOptions";
import { QrScanner } from "../components/QrScanner";
import { ApiError } from "../lib/api";
import type { AvailabilityItem, BorrowResult } from "../lib/types";

const DAY_PRESETS = [1, 3, 7, 14];

export function BrowseScreen() {
  const availability = useAvailability();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<BorrowResult | null>(null);
  const [confirmedAsset, setConfirmedAsset] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const borrow = useBorrow();
  const confirmUnit = useConfirmBorrow();
  const toast = useToast();

  const openSheet = (item: AvailabilityItem) => {
    setSelected(item); setDays(7); setResult(null);
    setConfirmedAsset(null); setManualId(""); setScanError(null);
    borrow.reset(); confirmUnit.reset();
  };
  const closeSheet = () => { setSelected(null); setResult(null); setConfirmedAsset(null); };

  const confirmAsset = (assetId: string) => {
    if (!result) return;
    confirmUnit.mutate({ session_id: result.session_id, asset_id: assetId }, {
      onSuccess: (r) => setConfirmedAsset(r.asset_id),
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
    borrow.mutate({ item_type_id: selected.item_type_id, days }, {
      onSuccess: (r) => setResult(r),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) { toast(errorMessage(e)); closeSheet(); }
      },
    });
  };

  if (availability.isLoading) return <Spinner />;
  if (availability.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load inventory. Pull to refresh.</p>;

  const groups = groupByCategory(filterInventory(availability.data ?? [], q));

  return (
    <div className="pb-4">
      <Input placeholder="Search equipment…" value={q} onChange={(e) => setQ(e.target.value)} className="my-3" />
      {groups.length === 0 && <p className="mt-8 text-center text-sm text-gray-500">No matches.</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{category}</h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.item_type_id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <Badge tone={item.available_units > 0 ? "green" : "gray"}>{item.available_units}/{item.total_units} available</Badge>
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
        {result && confirmedAsset ? (
          <div className="text-center">
            <h3 className="mb-1 text-lg font-semibold">All set</h3>
            <p className="mb-5 text-sm text-gray-600">
              <span className="font-mono">{confirmedAsset}</span> is checked out to you. Close the door when you're done.
            </p>
            <Button className="w-full" onClick={closeSheet}>Done</Button>
          </div>
        ) : result ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{borrowResultMessage(result).title}</h3>
            <p className="mb-3 text-sm text-gray-600">
              Take your item, then scan the QR label on it to confirm which one you took.
            </p>
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <Input placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || confirmUnit.isPending}
                onClick={() => confirmAsset(parseAssetId(manualId)!)}>
                {confirmUnit.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
            <button className="mt-4 w-full text-center text-xs text-gray-400 underline" onClick={closeSheet}>
              Can't scan right now? Confirm later from My Items — borrowing is paused until you do
            </button>
          </div>
        ) : selected && selected.available_units === 0 ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{selected.name} is unavailable</h3>
            <p className="mb-4 text-sm text-gray-500">All units are out. You can:</p>
            <RequestOptions itemTypeId={selected.item_type_id} itemName={selected.name} />
          </div>
        ) : selected ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Borrow {selected.name}</h3>
            <p className="mb-4 text-sm text-gray-500">How long do you need it?</p>
            <div className="mb-4 flex gap-2">
              {DAY_PRESETS.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}>
                  {d}d
                </button>
              ))}
            </div>
            {borrow.isError && <p className="mb-3 text-sm text-red-600">{errorMessage(borrow.error)}</p>}
            <Button className="w-full" disabled={borrow.isPending} onClick={confirm}>
              {borrow.isPending ? "Unlocking…" : "Confirm & unlock"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

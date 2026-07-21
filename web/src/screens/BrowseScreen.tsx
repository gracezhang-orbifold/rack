import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAvailability, useRequestBorrow } from "../hooks/queries";
import { filterInventory, groupByCategory } from "../lib/filter";
import { errorMessage } from "../lib/borrowResult";
import { parseAssetId } from "../lib/scan";
import { Badge, Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { RequestOptions } from "../components/RequestOptions";
import { QrScanner } from "../components/QrScanner";
import type { AvailabilityItem } from "../lib/types";

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

// Browse asks for approval; the unlock (and label-scan confirmation) happens
// from My Assets once the request is approved. Auto-approve mode grants
// instantly, so usually it's request → straight to pickup.
export function BrowseScreen() {
  const availability = useAvailability();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [days, setDays] = useState(7);
  const [durationMode, setDurationMode] = useState<"days" | "hours" | "test5s">("days");
  const [hours, setHours] = useState("");
  const [withKit, setWithKit] = useState(false);
  const [requested, setRequested] = useState<{ status: "pending" | "approved"; already?: boolean } | null>(null);
  const [labelScan, setLabelScan] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [labelScanKey, setLabelScanKey] = useState(0);
  const [labelScanError, setLabelScanError] = useState<string | null>(null);
  const request = useRequestBorrow();
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
    setSelected(item); setDays(7); setRequested(null);
    setDurationMode("days"); setHours(""); setWithKit(false);
    request.reset();
  };
  const closeSheet = () => { setSelected(null); setRequested(null); };

  const kitOffer = selected?.accessory && selected.accessory.available_units > 0 ? selected.accessory : null;

  const hoursValid = Number.isInteger(Number(hours)) && Number(hours) >= 1 && Number(hours) <= 90 * 24;
  const durationValid = durationMode !== "hours" || hoursValid;
  const requestCheckout = () => {
    if (!selected) return;
    const duration_seconds = durationMode === "hours" ? Number(hours) * 3600
      : durationMode === "test5s" ? 5 : undefined;
    request.mutate({ item_type_id: selected.item_type_id, days, duration_seconds,
      with_accessory: kitOffer && withKit ? true : undefined }, {
      onSuccess: (r) => setRequested({ status: r.status, already: r.already_requested }),
      onError: (e) => toast(errorMessage(e), "error"),
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
        {requested ? (
          <div className="text-center">
            {requested.status === "approved" ? (
              <>
                <h3 className="mb-1 text-lg font-semibold">Approved</h3>
                <p className="mb-5 text-sm text-muted">
                  {requested.already ? "You already had an open request for this item — it's " : "Your checkout is "}
                  ready for pickup. Unlock the cabinet from My Assets when you're at the rack.
                </p>
                <Button className="w-full" onClick={() => navigate("/my-items")}>Go to My Assets</Button>
                <button className="mt-3 w-full text-center text-xs text-muted/70 underline" onClick={closeSheet}>
                  Later — keep browsing
                </button>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-semibold">Request sent</h3>
                <p className="mb-5 text-sm text-muted">
                  An admin needs to approve this checkout. You'll get a notification with the decision —
                  then pick it up from My Assets.
                </p>
                <Button className="w-full" onClick={closeSheet}>Done</Button>
              </>
            )}
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
            <div className="mb-2 flex gap-2">
              {DAY_PRESETS.map((d) => (
                <button key={d} onClick={() => { setDurationMode("days"); setDays(d); }}
                  className={`min-h-[44px] flex-1 rounded-xl border ${durationMode === "days" && days === d ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
                  {d}d
                </button>
              ))}
              <button onClick={() => setDurationMode("hours")}
                className={`min-h-[44px] flex-1 rounded-xl border ${durationMode === "hours" ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
                hrs
              </button>
            </div>
            {durationMode === "hours" && (
              <div className="mb-2 flex items-center gap-2">
                <Input type="number" min={1} max={90 * 24} placeholder="How many hours?"
                  value={hours} onChange={(e) => setHours(e.target.value)} />
                <span className="shrink-0 text-sm text-muted">hours</span>
              </div>
            )}
            <button className="mb-4 block text-xs text-muted/60 underline"
              onClick={() => setDurationMode(durationMode === "test5s" ? "days" : "test5s")}>
              {durationMode === "test5s" ? "✓ 5-second checkout armed — tap to undo" : "Check out for 5 seconds (test)"}
            </button>
            {kitOffer && (
              <label className="mb-4 flex items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-4 w-4" checked={withKit}
                  onChange={(e) => setWithKit(e.target.checked)} />
                Also take an accessory kit ({kitOffer.available_units} available)
              </label>
            )}
            {request.isError && <p className="mb-3 text-sm text-danger">{errorMessage(request.error)}</p>}
            <Button className="w-full" disabled={request.isPending || !durationValid} onClick={requestCheckout}>
              {request.isPending ? "Requesting…" : "Request approval"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

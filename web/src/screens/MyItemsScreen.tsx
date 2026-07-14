import { useState } from "react";
import {
  useCancelRequest, useConfirmBorrow, useExtend, useMyBorrows, useMyRequests, useReturn,
  useSettings, useUpdateSettings,
} from "../hooks/queries";
import { Badge, Button, Sheet, Spinner, useToast } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { errorMessage } from "../lib/borrowResult";
import { parseAssetId } from "../lib/scan";
import { ApiError } from "../lib/api";
import type { ActiveBorrow, ItemRequest } from "../lib/types";

const EXTEND_PRESETS = [1, 3, 7, 14];

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

function requestLabel(r: ItemRequest) {
  if (r.kind === "waitlist") return `Waitlist — #${r.position ?? "?"} in line`;
  if (r.kind === "notify") return "Email when available";
  return `Reserved ${r.start_at ? fmt(r.start_at) : ""} · ${r.days}d`;
}

// Reminder emails: heads-up N days before due, overdue nag cadence.
function ReminderSettingsCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  if (!settings.data || typeof settings.data.remind_before_days !== "number") return null;
  const save = (body: Parameters<typeof update.mutate>[0]) =>
    update.mutate(body, {
      onSuccess: () => toast("Reminder settings saved."),
      onError: (e) => toast(errorMessage(e), "error"),
    });
  return (
    <div className="mt-6 rounded-xl bg-white p-3 shadow-sm">
      <p className="mb-2 text-sm font-medium">Email reminders</p>
      <label className="mb-2 flex items-center justify-between text-sm text-gray-600">
        Heads-up before due
        <select className="rounded-lg border border-gray-300 px-2 py-1"
          value={settings.data.remind_before_days} disabled={update.isPending}
          onChange={(e) => save({ remind_before_days: Number(e.target.value) })}>
          <option value={0}>Off</option>
          <option value={1}>1 day before</option>
          <option value={2}>2 days before</option>
          <option value={3}>3 days before</option>
          <option value={7}>1 week before</option>
        </select>
      </label>
      <label className="flex items-center justify-between text-sm text-gray-600">
        Overdue reminders
        <select className="rounded-lg border border-gray-300 px-2 py-1"
          value={settings.data.overdue_reminder_every_days} disabled={update.isPending}
          onChange={(e) => save({ overdue_reminder_every_days: Number(e.target.value) })}>
          <option value={0}>Off</option>
          <option value={1}>Daily</option>
          <option value={3}>Every 3 days</option>
          <option value={7}>Weekly</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-gray-400">Reminder emails go out at 9:00 AM.</p>
    </div>
  );
}

export function MyItemsScreen() {
  const borrows = useMyBorrows();
  const requests = useMyRequests();
  const cancelRequest = useCancelRequest();
  const ret = useReturn();
  const extend = useExtend();
  const confirmUnit = useConfirmBorrow();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ kind: "menu" | "return" | "extend" | "confirm"; b: ActiveBorrow } | null>(null);
  const [done, setDone] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [days, setDays] = useState(7);
  const [manualId, setManualId] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState("");

  const open = (kind: "menu" | "return" | "extend" | "confirm", b: ActiveBorrow) => {
    setSheet({ kind, b }); setDone(false); setDays(7);
    setManualId(""); setScanError(null);
    setDamaged(false); setNote("");
    ret.reset(); extend.reset(); confirmUnit.reset();
  };
  const close = () => { setSheet(null); setDone(false); };

  const conditionIncomplete = damaged && !note.trim();
  const doReturn = (asset_id?: string) => {
    if (!sheet) return;
    ret.mutate({ session_id: sheet.b.session_id, asset_id, damaged, note: note.trim() || undefined }, {
      onSuccess: () => setDone(true),
      onError: (e) => {
        const msg = e instanceof ApiError ? e.message : errorMessage(e);
        if (sheet.b.asset_id) { setScanError(msg); setScanKey((k) => k + 1); }
        else toast(msg, "error");
      },
    });
  };
  const doConfirmUnit = (asset_id: string) => {
    if (!sheet) return;
    confirmUnit.mutate({ session_id: sheet.b.session_id, asset_id }, {
      onSuccess: (r) => { toast(`Confirmed — you have ${r.asset_id}.`); close(); },
      onError: (e) => {
        setScanError(e instanceof ApiError ? e.message : errorMessage(e));
        setScanKey((k) => k + 1);
      },
    });
  };
  const onDecoded = (text: string) => {
    if (sheet?.kind === "return" && conditionIncomplete) {
      setScanError("Describe the damage first, then scan again.");
      setScanKey((k) => k + 1);
      return;
    }
    const assetId = parseAssetId(text);
    if (!assetId) {
      setScanError("That doesn't look like a Rack label — try again or type the ID.");
      setScanKey((k) => k + 1);
      return;
    }
    setScanError(null);
    if (sheet?.kind === "confirm") doConfirmUnit(assetId);
    else doReturn(assetId);
  };

  const conditionFields = (
    <div className="mb-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="h-4 w-4" checked={damaged}
          onChange={(e) => setDamaged(e.target.checked)} />
        The item is damaged
      </label>
      {damaged && (
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Describe the damage (required)"
          className="mt-2 w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-gray-900 focus:outline-none" />
      )}
    </div>
  );
  const doExtend = () => {
    if (!sheet) return;
    extend.mutate({ session_id: sheet.b.session_id, days }, {
      onSuccess: (r) => { toast(`Extended — now due ${fmt(r.due_at)}.`); close(); },
      onError: (e) => toast(e instanceof ApiError ? e.message : errorMessage(e), "error"),
    });
  };

  if (borrows.isLoading) return <Spinner />;
  if (borrows.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load your items.</p>;
  const { active, history } = borrows.data!;

  return (
    <div className="py-3">
      <h2 className="mb-3 text-lg font-semibold">Your items</h2>
      {active.length === 0 && <p className="text-sm text-gray-500">Nothing checked out.</p>}
      <ul className="flex flex-col gap-2">
        {active.map((b) => (
          <li key={b.session_id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
            <div>
              <p className="font-medium">{b.item_name}{b.asset_id ? <span className="font-mono text-xs text-gray-400"> · {b.asset_id}</span> : null}</p>
              {!b.unit_confirmed
                ? <Badge tone="amber">Scan needed — confirm which unit you took</Badge>
                : b.is_overdue
                  ? <Badge tone="red">Overdue — due {fmt(b.due_at)}</Badge>
                  : <span className="text-xs text-gray-500">Due {fmt(b.due_at)}</span>}
            </div>
            <button aria-label={`More options for ${b.item_name}`}
              className="min-h-[44px] min-w-[44px] rounded-xl text-xl font-bold text-gray-500 active:bg-gray-100"
              onClick={() => open("menu", b)}>
              ⋯
            </button>
          </li>
        ))}
      </ul>

      {(requests.data?.length ?? 0) > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Your requests</h3>
          <ul className="flex flex-col gap-2">
            {requests.data!.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
                <div>
                  <p className="text-sm font-medium">{r.item_name}</p>
                  <span className="text-xs text-gray-500">{requestLabel(r)}</span>
                </div>
                <button className="text-sm text-gray-500 underline" disabled={cancelRequest.isPending}
                  onClick={() => cancelRequest.mutate(r.id, { onError: (e) => toast(errorMessage(e), "error") })}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <ReminderSettingsCard />

      <button className="mt-6 text-sm text-gray-500 underline" onClick={() => setShowHistory((s) => !s)}>
        {showHistory ? "Hide history" : `History (${history.length})`}
      </button>
      {showHistory && (
        <ul className="mt-2 flex flex-col gap-2">
          {history.map((h) => (
            <li key={h.session_id} className="text-sm text-gray-600">
              <div className="flex justify-between">
                <span>{h.item_name}{h.asset_id ? <span className="font-mono text-xs text-gray-400"> · {h.asset_id}</span> : null}</span>
                <span>{h.status}</span>
              </div>
              <p className="text-xs text-gray-400">
                Borrowed {fmt(h.checked_out_at)}{h.returned_at ? ` — returned ${fmt(h.returned_at)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={sheet !== null} onClose={close}>
        {done ? (
          <div className="text-center">
            <h3 className="mb-1 text-lg font-semibold">{damaged ? "Damage reported" : "Cabinet unlocked"}</h3>
            <p className="mb-5 text-sm text-gray-600">
              {damaged
                ? "Put the item back and close the door — the admins have been notified and the unit is marked for repair."
                : "Put the item back and close the door."}
            </p>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : sheet?.kind === "menu" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{sheet.b.item_name}</h3>
            <p className="mb-3 text-sm text-gray-500">
              {sheet.b.asset_id ? <span className="font-mono">{sheet.b.asset_id} · </span> : null}
              Due {fmt(sheet.b.due_at)}
            </p>
            <div className="flex flex-col gap-2">
              {!sheet.b.unit_confirmed && (
                <Button onClick={() => open("confirm", sheet.b)}>Scan ID</Button>
              )}
              <Button variant="secondary" onClick={() => open("return", sheet.b)}>Return</Button>
              <Button variant="secondary" onClick={() => open("extend", sheet.b)}>Extend deadline</Button>
            </div>
          </div>
        ) : sheet?.kind === "confirm" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Which {sheet.b.item_name} did you take?</h3>
            <p className="mb-3 text-sm text-gray-500">
              Scan the QR label on the item in your hands (or type its ID). You can't borrow anything
              else until this checkout is confirmed.
            </p>
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <input className="min-h-[44px] w-full rounded-xl border border-gray-300 px-3 focus:border-gray-900 focus:outline-none"
                placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || confirmUnit.isPending}
                onClick={() => doConfirmUnit(parseAssetId(manualId)!)}>
                {confirmUnit.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
          </div>
        ) : sheet?.kind === "extend" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Extend {sheet.b.item_name}</h3>
            <p className="mb-4 text-sm text-gray-500">Currently due {fmt(sheet.b.due_at)}. Extend by how long?</p>
            <div className="mb-4 flex gap-2">
              {EXTEND_PRESETS.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}>
                  +{d}d
                </button>
              ))}
            </div>
            <Button className="w-full" disabled={extend.isPending} onClick={doExtend}>
              {extend.isPending ? "Extending…" : "Extend loan"}
            </Button>
          </div>
        ) : sheet?.kind === "return" && sheet.b.asset_id ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return {sheet.b.item_name}?</h3>
            <p className="mb-3 text-sm text-gray-500">
              Scan the label on the item (<span className="font-mono">{sheet.b.asset_id}</span>) to confirm,
              then the cabinet will unlock.
            </p>
            {conditionFields}
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <input className="min-h-[44px] w-full rounded-xl border border-gray-300 px-3 focus:border-gray-900 focus:outline-none"
                placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || conditionIncomplete || ret.isPending}
                onClick={() => doReturn(parseAssetId(manualId)!)}>
                {ret.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
          </div>
        ) : sheet ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return {sheet.b.item_name}?</h3>
            <p className="mb-4 text-sm text-gray-500">The cabinet will unlock so you can put it back.</p>
            {conditionFields}
            {ret.isError && <p className="mb-3 text-sm text-red-600">{errorMessage(ret.error)}</p>}
            <Button className="w-full" disabled={ret.isPending || conditionIncomplete} onClick={() => doReturn()}>
              {ret.isPending ? "Unlocking…" : "Confirm & unlock"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

import { useState } from "react";
import { useCancelRequest, useCreateRequest, useMyRequests } from "../hooks/queries";
import { Button, Input, useToast } from "./ui";
import { errorMessage } from "../lib/borrowResult";
import type { RequestKind } from "../lib/types";

const DAY_PRESETS = [1, 3, 7, 14];

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// Actions for an item with no available units: join the waitlist, get a
// one-shot availability email, or reserve a future date.
export function RequestOptions({ itemTypeId, itemName }: { itemTypeId: string; itemName: string }) {
  const requests = useMyRequests();
  const create = useCreateRequest();
  const cancel = useCancelRequest();
  const toast = useToast();
  const [reserving, setReserving] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState(7);

  const mine = (kind: RequestKind) =>
    requests.data?.find((r) => r.item_type_id === itemTypeId && r.kind === kind);

  const add = (kind: RequestKind, extra?: { start_at: string; days: number }) =>
    create.mutate({ item_type_id: itemTypeId, kind, ...extra }, {
      onSuccess: () => {
        setReserving(false);
        toast(kind === "waitlist" ? "You're on the waitlist."
          : kind === "notify" ? `We'll email you when ${itemName} is available.`
          : "Reservation saved — we'll email you before it starts.");
      },
      onError: (e) => toast(errorMessage(e), "error"),
    });

  const remove = (id: string) =>
    cancel.mutate(id, { onError: (e) => toast(errorMessage(e), "error") });

  const waitlist = mine("waitlist");
  const notify = mine("notify");
  const reservation = mine("reservation");
  const busy = create.isPending || cancel.isPending;

  if (reserving) {
    const confirmReserve = () => {
      if (!startDate) return;
      add("reservation", { start_at: `${startDate}T12:00:00`, days });
    };
    return (
      <div>
        <p className="mb-2 text-sm font-medium">Reserve {itemName}</p>
        <label className="mb-2 block text-xs text-muted">Start date
          <Input type="date" value={startDate} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
            onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
        </label>
        <p className="mb-1 text-xs text-muted">For how long?</p>
        <div className="mb-3 flex gap-2">
          {DAY_PRESETS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
              {d}d
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setReserving(false)}>Back</Button>
          <Button className="flex-1" disabled={!startDate || busy} onClick={confirmReserve}>Reserve</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {waitlist ? (
        <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
          <span className="text-sm">On waitlist — #{waitlist.position ?? "?"} in line</span>
          <button className="text-sm text-muted underline" disabled={busy} onClick={() => remove(waitlist.id)}>Leave</button>
        </div>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => add("waitlist")}>Join waitlist</Button>
      )}
      {notify ? (
        <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
          <span className="text-sm">You'll be emailed when it's available</span>
          <button className="text-sm text-muted underline" disabled={busy} onClick={() => remove(notify.id)}>Cancel</button>
        </div>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => add("notify")}>Notify me when available</Button>
      )}
      {reservation ? (
        <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
          <span className="text-sm">Reserved {reservation.start_at ? fmt(reservation.start_at) : ""} · {reservation.days}d</span>
          <button className="text-sm text-muted underline" disabled={busy} onClick={() => remove(reservation.id)}>Cancel</button>
        </div>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => setReserving(true)}>Reserve for a future time</Button>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";
import { useCancelRequest, useMyRequests, useMyServiceRequests } from "../hooks/queries";
import { Badge, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { ItemRequest } from "../lib/types";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

function requestLabel(r: ItemRequest) {
  if (r.kind === "waitlist") return `Waitlist — #${r.position ?? "?"} in line`;
  if (r.kind === "notify") return "Email when available";
  return `Reserved ${r.start_at ? fmt(r.start_at) : ""} · ${r.days}d`;
}

// "View Request Status": everything the user is waiting on — item requests
// (waitlist / notify / reservations) and service requests they raised.
export function RequestStatusScreen() {
  const requests = useMyRequests();
  const service = useMyServiceRequests();
  const cancelRequest = useCancelRequest();
  const toast = useToast();

  if (requests.isLoading || service.isLoading) return <Spinner />;

  const items = requests.data ?? [];
  const srs = service.data ?? [];

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">Your requests</h2>

      <h3 className="mb-2 text-sm font-semibold text-muted">Item requests</h3>
      {items.length === 0 && (
        <p className="mb-2 text-sm text-muted">
          Nothing yet — when an item is out of stock, <Link className="text-primary-soft underline" to="/requests/new">raise a request</Link>.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <div>
              <p className="text-sm font-medium">{r.item_name}</p>
              <span className="text-xs text-muted">{requestLabel(r)}</span>
            </div>
            <button className="text-sm text-muted underline" disabled={cancelRequest.isPending}
              onClick={() => cancelRequest.mutate(r.id, { onError: (e) => toast(errorMessage(e), "error") })}>
              Cancel
            </button>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-muted">Service requests</h3>
      {srs.length === 0 && (
        <p className="mb-2 text-sm text-muted">
          No problems reported. <Link className="text-primary-soft underline" to="/requests/service">Raise a service request</Link> if something's wrong with an item.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {srs.map((s) => (
          <li key={s.id} className="rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{s.item_name} <span className="font-mono text-xs text-muted/70">· {s.asset_id}</span></p>
              <Badge tone={s.status === "open" ? "amber" : "green"}>{s.status === "open" ? "Open" : "Resolved"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{s.description}</p>
            <p className="mt-1 text-xs text-muted/70">Raised {fmt(s.created_at)}{s.resolved_at ? ` — resolved ${fmt(s.resolved_at)}` : ""}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

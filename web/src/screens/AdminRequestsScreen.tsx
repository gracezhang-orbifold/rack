import { Link } from "react-router-dom";
import { useAdminAttention, useAdminServiceRequests, useResolveAttention, useResolveServiceRequest } from "../hooks/queries";
import { Badge, Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// "View Request": everything waiting on an admin — returns that need
// attention (flagged contents / damage) and open service requests.
export function AdminRequestsScreen() {
  const attention = useAdminAttention();
  const service = useAdminServiceRequests();
  const resolveAtt = useResolveAttention();
  const resolveSr = useResolveServiceRequest();
  const toast = useToast();

  if (attention.isLoading || service.isLoading) return <Spinner />;

  const att = attention.data ?? [];
  const srs = service.data ?? [];

  return (
    <div className="animate-fade-up py-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <section className="mb-5 lg:mb-0">
        <h2 className="mb-2 text-lg font-semibold">Needs attention ({att.length})</h2>
        {att.length === 0 && <p className="text-sm text-muted">No returns need attention.</p>}
        <ul className="flex flex-col gap-2">
          {att.map((a) => (
            <li key={a.session_id} className="rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {a.item_name}
                  {a.asset_id ? <span className="font-mono text-xs text-muted/70"> · {a.asset_id}</span> : null}
                </p>
                <div className="flex gap-1">
                  {a.return_flagged && <Badge tone="amber">Flagged</Badge>}
                  {a.return_damaged && <Badge tone="red">Damaged</Badge>}
                </div>
              </div>
              <p className="text-xs text-muted">Returned by {a.full_name ?? a.email} · {fmt(a.returned_at)}</p>
              {a.answers.map((p, i) => (
                <p key={i} className="text-sm text-text">
                  {p.label} <strong>{p.value === true ? "yes" : p.value === false ? "no" : p.value}</strong>
                </p>
              ))}
              {a.return_note && <p className="text-sm text-danger">Damage: {a.return_note}</p>}
              <div className="mt-2 flex items-center justify-between">
                {a.return_damaged
                  ? <Link to="/admin/service" className="text-xs text-muted underline">Unit is in repair — manage under service</Link>
                  : <span />}
                <Button variant="secondary" disabled={resolveAtt.isPending}
                  onClick={() => resolveAtt.mutate(a.session_id, {
                    onSuccess: () => toast("Resolved."),
                    onError: (e) => toast(errorMessage(e), "error"),
                  })}>
                  Resolve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Service requests ({srs.length})</h2>
        {srs.length === 0 && <p className="text-sm text-muted">No open service requests.</p>}
        <ul className="flex flex-col gap-2">
          {srs.map((s) => (
            <li key={s.id} className="rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
              <div className="flex items-center justify-between">
                <p className="font-medium">{s.item_name} <span className="font-mono text-xs text-muted/70">· {s.asset_id}</span></p>
                <Badge tone="amber">Open</Badge>
              </div>
              <p className="text-xs text-muted">Reported by {s.full_name ?? s.email} · {fmt(s.created_at)}</p>
              <p className="mt-1 text-sm text-text">{s.description}</p>
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" disabled={resolveSr.isPending}
                  onClick={() => resolveSr.mutate(s.id, {
                    onSuccess: () => toast("Service request resolved."),
                    onError: (e) => toast(errorMessage(e), "error"),
                  })}>
                  Resolve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

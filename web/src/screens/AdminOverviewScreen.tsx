import { Link } from "react-router-dom";
import { useAdminBorrows, useAdminReturn, useAdminAttention, useResolveAttention } from "../hooks/queries";
import { Badge, Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

export function AdminOverviewScreen() {
  const borrows = useAdminBorrows();
  const ret = useAdminReturn();
  const attention = useAdminAttention();
  const resolve = useResolveAttention();
  const toast = useToast();

  if (borrows.isLoading) return <Spinner />;
  if (borrows.isError) return <p className="p-4 text-sm text-muted">Couldn't load borrows.</p>;
  const { active } = borrows.data!;

  const markReturned = (session_id: string) =>
    ret.mutate(session_id, {
      onSuccess: () => toast("Marked returned."),
      onError: (e) => toast(errorMessage(e), "error"),
    });

  return (
    <div className="animate-fade-up py-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {(attention.data?.length ?? 0) > 0 && (
        <section className="mb-5 lg:mb-0">
          <h2 className="mb-2 text-lg font-semibold">Needs attention ({attention.data!.length})</h2>
          <ul className="flex flex-col gap-2">
            {attention.data!.map((a) => (
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
                    ? <Link to="/admin/inventory" className="text-xs text-muted underline">Unit is in repair — manage in inventory</Link>
                    : <span />}
                  <Button variant="secondary" disabled={resolve.isPending}
                    onClick={() => resolve.mutate(a.session_id, {
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
      )}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Checked out</h2>
          <Link to="/admin/inventory" className="text-sm text-muted underline">Inventory</Link>
        </div>
        {active.length === 0 && <p className="text-sm text-muted">Nothing is checked out.</p>}
        <ul className="flex flex-col gap-2">
          {active.map((b) => (
            <li key={b.session_id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
              <div>
                <p className="font-medium">{b.item_name}{b.asset_id ? <span className="font-mono text-xs text-muted/70"> · {b.asset_id}</span> : null}</p>
                <p className="text-xs text-muted">{b.full_name ?? b.email} · {b.email}</p>
                {b.is_overdue ? <Badge tone="red">Overdue — due {fmt(b.due_at)}</Badge> : <span className="text-xs text-muted">Due {fmt(b.due_at)}</span>}
              </div>
              <Button variant="secondary" disabled={ret.isPending} onClick={() => markReturned(b.session_id)}>Mark returned</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

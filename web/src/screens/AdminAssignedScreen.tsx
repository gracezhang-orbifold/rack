import { useAdminBorrows, useAdminReturn } from "../hooks/queries";
import { Badge, Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// "Assigned Assets": who has what right now, with a force-return escape hatch.
export function AdminAssignedScreen() {
  const borrows = useAdminBorrows();
  const ret = useAdminReturn();
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
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">Assigned assets</h2>
      {active.length === 0 && <p className="text-sm text-muted">Nothing is checked out.</p>}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
    </div>
  );
}

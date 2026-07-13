import { Link } from "react-router-dom";
import { useAdminBorrows, useAdminReturn } from "../hooks/queries";
import { Badge, Button, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

export function AdminOverviewScreen() {
  const borrows = useAdminBorrows();
  const ret = useAdminReturn();
  const toast = useToast();

  if (borrows.isLoading) return <Spinner />;
  if (borrows.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load borrows.</p>;
  const { active } = borrows.data!;

  const markReturned = (session_id: string) =>
    ret.mutate(session_id, {
      onSuccess: () => toast("Marked returned."),
      onError: (e) => toast(errorMessage(e), "error"),
    });

  return (
    <div className="py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Checked out</h2>
        <Link to="/admin/inventory" className="text-sm text-gray-500 underline">Inventory</Link>
      </div>
      {active.length === 0 && <p className="text-sm text-gray-500">Nothing is checked out.</p>}
      <ul className="flex flex-col gap-2">
        {active.map((b) => (
          <li key={b.session_id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
            <div>
              <p className="font-medium">{b.item_name}</p>
              <p className="text-xs text-gray-500">{b.full_name ?? b.email} · {b.email}</p>
              {b.is_overdue ? <Badge tone="red">Overdue — due {fmt(b.due_at)}</Badge> : <span className="text-xs text-gray-500">Due {fmt(b.due_at)}</span>}
            </div>
            <Button variant="secondary" disabled={ret.isPending} onClick={() => markReturned(b.session_id)}>Mark returned</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

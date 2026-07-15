import { Link } from "react-router-dom";
import { useAdminAttention, useAdminBorrows, useAdminServiceRequests, useAvailability } from "../hooks/queries";
import { Badge, Spinner } from "../components/ui";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

function Stat({ label, value, to }: { label: string; value: number | string; to: string }) {
  return (
    <Link to={to} className="rounded-xl bg-surface p-4 shadow-sm shadow-black/20 transition-colors hover:bg-surface-2">
      <p className="font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Link>
  );
}

// Admin Dashboard: the numbers that matter, computed from data the API
// already serves, plus whatever needs attention right now.
export function AdminDashboardScreen() {
  const availability = useAvailability();
  const borrows = useAdminBorrows();
  const attention = useAdminAttention();
  const service = useAdminServiceRequests();

  if (availability.isLoading || borrows.isLoading) return <Spinner />;

  const rows = availability.data ?? [];
  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total_units, available: a.available + r.available_units,
      inUse: a.inUse + r.in_use_units, repair: a.repair + r.needs_repair_units,
    }),
    { total: 0, available: 0, inUse: 0, repair: 0 });
  const active = borrows.data?.active ?? [];
  const overdue = active.filter((b) => b.is_overdue).length;
  const openRequests = (attention.data?.length ?? 0) + (service.data?.length ?? 0);

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-1 text-lg font-semibold">Dashboard</h2>
      <p className="mb-4 text-sm text-muted">Hi — here's the state of the rack.</p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total assets" value={totals.total} to="/admin/assets" />
        <Stat label="Available" value={totals.available} to="/admin/assets" />
        <Stat label="Assigned" value={active.length} to="/admin/assigned" />
        <Stat label="Overdue" value={overdue} to="/admin/assigned" />
        <Stat label="Under service" value={totals.repair} to="/admin/service" />
        <Stat label="Open requests" value={openRequests} to="/admin/requests" />
      </div>

      {(attention.data?.length ?? 0) > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted">Needs attention</h3>
            <Link to="/admin/requests" className="text-sm text-primary-soft underline">View all</Link>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {attention.data!.slice(0, 4).map((a) => (
              <li key={a.session_id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
                <div>
                  <p className="text-sm font-medium">{a.item_name}{a.asset_id ? <span className="font-mono text-xs text-muted/70"> · {a.asset_id}</span> : null}</p>
                  <p className="text-xs text-muted">Returned by {a.full_name ?? a.email} · {fmt(a.returned_at)}</p>
                </div>
                <div className="flex gap-1">
                  {a.return_flagged && <Badge tone="amber">Flagged</Badge>}
                  {a.return_damaged && <Badge tone="red">Damaged</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

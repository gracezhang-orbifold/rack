import { useAdminInventory, useUpdateUnit } from "../hooks/queries";
import { Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { UnitStatus } from "../lib/types";

const STATUSES: UnitStatus[] = ["available", "in_use", "needs_repair", "retired", "missing"];

// "Under Service": every unit parked in needs_repair, with the same status
// control the inventory uses — flip to available when it's fixed.
export function AdminServiceScreen() {
  const inventory = useAdminInventory();
  const updateUnit = useUpdateUnit();
  const toast = useToast();

  if (inventory.isLoading) return <Spinner />;
  if (inventory.isError) return <p className="p-4 text-sm text-muted">Couldn't load inventory.</p>;

  const units = (inventory.data ?? []).flatMap((t) =>
    t.units.filter((u) => u.status === "needs_repair").map((u) => ({ ...u, item_name: t.name, category: t.category })));

  const setStatus = (id: string, status: string) =>
    updateUnit.mutate({ id, body: { status } }, {
      onSuccess: () => toast("Unit updated."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">Under service</h2>
      {units.length === 0 && <p className="text-sm text-muted">Nothing is in repair.</p>}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {units.map((u) => (
          <li key={u.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <div>
              <p className="font-medium">{u.item_name}</p>
              <p className="text-xs text-muted">{u.category}{u.asset_id ? <span className="font-mono"> · {u.asset_id}</span> : null}{u.notes ? ` · ${u.notes}` : ""}</p>
            </div>
            <select className="rounded-lg border border-edge px-2 py-1 text-sm" defaultValue={u.status}
              aria-label={`Status for ${u.asset_id ?? u.item_name}`}
              onChange={(e) => setStatus(u.id, e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

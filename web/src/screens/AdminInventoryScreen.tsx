import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminInventory, useCreateItemType, useCreateUnits, useUpdateUnit } from "../hooks/queries";
import { Button, Input, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { UnitStatus } from "../lib/types";

const STATUSES: UnitStatus[] = ["available", "in_use", "needs_repair", "retired", "missing"];

export function AdminInventoryScreen() {
  const inventory = useAdminInventory();
  const createType = useCreateItemType();
  const createUnits = useCreateUnits();
  const updateUnit = useUpdateUnit();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");

  if (inventory.isLoading) return <Spinner />;
  if (inventory.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load inventory.</p>;

  const addType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCategory) return;
    createType.mutate({ name: newName, category: newCategory }, {
      onSuccess: () => { setNewName(""); setNewCategory(""); toast("Item type added."); },
      onError: (err) => toast(errorMessage(err), "error"),
    });
  };

  const addUnit = (item_type_id: string) =>
    createUnits.mutate({ item_type_id, count: 1 }, {
      onSuccess: () => toast("Unit added."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  const setStatus = (id: string, status: string) =>
    updateUnit.mutate({ id, body: { status } }, {
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <div className="py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <Link to="/admin" className="text-sm text-gray-500 underline">Overview</Link>
      </div>

      <form onSubmit={addType} className="mb-5 flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
        <p className="text-sm font-medium">Add item type</p>
        <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Input placeholder="Category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        <Button type="submit" disabled={createType.isPending}>Add type</Button>
      </form>

      <ul className="flex flex-col gap-3">
        {inventory.data!.map((t) => (
          <li key={t.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-gray-400">{t.category}{t.notes ? ` · ${t.notes}` : ""}</p>
              </div>
              <Button variant="secondary" onClick={() => addUnit(t.id)} disabled={createUnits.isPending}>+ Unit</Button>
            </div>
            <ul className="flex flex-col gap-1">
              {t.units.map((u) => (
                <li key={u.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{u.asset_id ?? u.id.slice(0, 8)}</span>
                  <select className="rounded-lg border border-gray-300 px-2 py-1" defaultValue={u.status}
                    onChange={(e) => setStatus(u.id, e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </li>
              ))}
              {t.units.length === 0 && <li className="text-xs text-gray-400">No units yet.</li>}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

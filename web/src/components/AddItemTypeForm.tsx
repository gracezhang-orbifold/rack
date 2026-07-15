import { useState } from "react";
import { useAdminInventory, useCreateItemType, useCreateUnits } from "../hooks/queries";
import { Button, Input, useToast } from "./ui";
import { errorMessage } from "../lib/borrowResult";

// Add-item-type form with duplicate detection and category suggestions.
// Shared by the Add Asset page and the Total Assets (inventory) screen.
export function AddItemTypeForm() {
  const inventory = useAdminInventory();
  const createType = useCreateItemType();
  const createUnits = useCreateUnits();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const types = inventory.data ?? [];
  const categories = [...new Set(types.map((t) => t.category))].sort();
  // An item type is a duplicate when both name and category already exist.
  const duplicate = types.find(
    (t) => t.name.trim().toLowerCase() === newName.trim().toLowerCase()
      && t.category.trim().toLowerCase() === newCategory.trim().toLowerCase());

  const addUnit = (item_type_id: string) =>
    createUnits.mutate({ item_type_id, count: 1 }, {
      onSuccess: () => toast("Unit added."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  const addType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCategory || duplicate) return;
    createType.mutate({ name: newName, category: newCategory }, {
      onSuccess: () => { setNewName(""); setNewCategory(""); toast("Item type added."); },
      onError: (err) => toast(errorMessage(err), "error"),
    });
  };

  return (
    <form onSubmit={addType} className="mb-5 flex flex-col gap-2 rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
      <p className="text-sm font-medium">Add item type</p>
      <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
      <Input placeholder="Category" list="category-options" value={newCategory}
        onChange={(e) => setNewCategory(e.target.value)} />
      <datalist id="category-options">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
      {duplicate && (
        <div className="rounded-xl bg-warning/15 p-3 text-sm text-warning">
          <p className="mb-2">
            <span className="font-medium">{duplicate.name}</span> already exists in{" "}
            <span className="font-medium">{duplicate.category}</span> — change the name or
            category, or add a unit to the existing item instead.
          </p>
          <Button variant="secondary" type="button" disabled={createUnits.isPending}
            onClick={() => { addUnit(duplicate.id); setNewName(""); setNewCategory(""); }}>
            Add a unit to the existing item
          </Button>
        </div>
      )}
      <Button type="submit" disabled={createType.isPending || !!duplicate}>Add type</Button>
    </form>
  );
}

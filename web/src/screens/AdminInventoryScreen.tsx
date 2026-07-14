import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminInventory, useCreateItemType, useCreateUnits, useUnitHistory, useUpdateItemType, useUpdateUnit } from "../hooks/queries";
import { Button, Input, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { AdminItemType, ReturnQuestion, UnitStatus } from "../lib/types";

const STATUSES: UnitStatus[] = ["available", "in_use", "needs_repair", "retired", "missing"];

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// Current and previous borrowers of one unit, loaded when the row expands.
function UnitHistory({ unitId }: { unitId: string }) {
  const history = useUnitHistory(unitId);
  if (history.isLoading) return <p className="py-1 text-xs text-gray-400">Loading history…</p>;
  if (history.isError) return <p className="py-1 text-xs text-red-600">Couldn't load history.</p>;
  if (history.data!.length === 0) return <p className="py-1 text-xs text-gray-400">Never borrowed.</p>;
  return (
    <ul className="flex flex-col gap-1 py-1">
      {history.data!.map((s) => (
        <li key={s.session_id} className="text-xs text-gray-600">
          <span className="font-medium">{s.full_name ?? s.email}</span>
          {s.full_name && <span className="text-gray-400"> · {s.email}</span>}
          {s.status === "active"
            ? <span className="text-amber-700"> — has it since {fmt(s.checked_out_at)}</span>
            : <span> — {fmt(s.checked_out_at)} → {s.returned_at ? fmt(s.returned_at) : s.status}</span>}
          {s.return_damaged && (
            <p className="text-red-600">Returned damaged{s.return_note ? `: ${s.return_note}` : ""}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// Per-type return questionnaire editor. Question ids are minted here (short
// random strings) so stored answers stay linked when labels are edited later.
function ReturnQuestionsEditor({ type }: { type: AdminItemType }) {
  const update = useUpdateItemType();
  const toast = useToast();
  const [draft, setDraft] = useState<ReturnQuestion[]>(type.return_questions);
  const [saved, setSaved] = useState<ReturnQuestion[]>(type.return_questions);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"text" | "yes_no">("text");
  const [flag, setFlag] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const add = () => {
    if (!label.trim()) return;
    setDraft([...draft, {
      id: (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 8), label: label.trim(), kind,
      ...(kind === "yes_no" && flag ? { flag_if_yes: true as const } : {}),
    }]);
    setLabel(""); setKind("text"); setFlag(false);
  };
  const save = () =>
    update.mutate({ id: type.id, body: { return_questions: draft } }, {
      onSuccess: (r) => {
        setSaved(r.return_questions); setDraft(r.return_questions);
        toast("Return questions saved.");
      },
      onError: (e) => toast(errorMessage(e), "error"),
    });

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-2">
      <ul className="flex flex-col gap-1">
        {draft.map((q, i) => (
          <li key={q.id} className="flex items-center justify-between text-sm text-gray-700">
            <span>
              {q.label}
              <span className="ml-1 text-xs text-gray-400">{q.kind === "yes_no" ? "yes/no" : "text"}{q.flag_if_yes ? " · flags" : ""}</span>
            </span>
            <button className="text-xs text-gray-500 underline"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {draft.length === 0 && <li className="text-xs text-gray-400">No return questions yet.</li>}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="Question label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <label className="flex items-center gap-1">
            Answer type
            <select className="rounded-lg border border-gray-300 px-2 py-1" value={kind}
              onChange={(e) => setKind(e.target.value as "text" | "yes_no")}>
              <option value="text">text</option>
              <option value="yes_no">yes/no</option>
            </select>
          </label>
          {kind === "yes_no" && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />
              Flag for attention if yes
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={add} disabled={!label.trim()}>Add question</Button>
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? "Saving…" : "Save questions"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AdminInventoryScreen() {
  const inventory = useAdminInventory();
  const createType = useCreateItemType();
  const createUnits = useCreateUnits();
  const updateUnit = useUpdateUnit();
  const updateItemType = useUpdateItemType();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [editQuestions, setEditQuestions] = useState<string | null>(null);
  const [q, setQ] = useState("");

  if (inventory.isLoading) return <Spinner />;
  if (inventory.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load inventory.</p>;

  const categories = [...new Set(inventory.data!.map((t) => t.category))].sort();
  // An item type is a duplicate when both name and category already exist.
  const duplicate = inventory.data!.find(
    (t) => t.name.trim().toLowerCase() === newName.trim().toLowerCase()
      && t.category.trim().toLowerCase() === newCategory.trim().toLowerCase());

  const term = q.trim().toLowerCase();
  const visible = !term ? inventory.data! : inventory.data!.filter(
    (t) => t.name.toLowerCase().includes(term) || t.category.toLowerCase().includes(term)
      || t.units.some((u) => u.asset_id?.toLowerCase().includes(term)));

  const addType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCategory || duplicate) return;
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

  const setAccessory = (id: string, accessory_type_id: string | null) =>
    updateItemType.mutate({ id, body: { accessory_type_id } }, {
      onSuccess: () => toast("Accessory kit updated."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <div className="py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <div className="flex gap-3">
          <Link to="/admin/labels" className="text-sm text-gray-500 underline">QR labels</Link>
          <Link to="/admin" className="text-sm text-gray-500 underline">Overview</Link>
        </div>
      </div>

      <form onSubmit={addType} className="mb-5 flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
        <p className="text-sm font-medium">Add item type</p>
        <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Input placeholder="Category" list="category-options" value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)} />
        <datalist id="category-options">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
        {duplicate && (
          <div className="rounded-xl bg-amber-100 p-3 text-sm text-amber-800">
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

      <Input placeholder="Search inventory…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      {visible.length === 0 && <p className="mt-6 text-center text-sm text-gray-500">No matches.</p>}
      <ul className="flex flex-col gap-3">
        {visible.map((t) => (
          <li key={t.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-gray-400">{t.category}{t.notes ? ` · ${t.notes}` : ""}</p>
              </div>
              <Button variant="secondary" onClick={() => addUnit(t.id)} disabled={createUnits.isPending}>+ Unit</Button>
            </div>
            <button className="mb-2 text-xs text-gray-500 underline"
              onClick={() => setEditQuestions(editQuestions === t.id ? null : t.id)}>
              Return questions ({t.return_questions.length})
            </button>
            {editQuestions === t.id && <ReturnQuestionsEditor type={t} />}
            <label className="mb-2 flex items-center justify-between text-xs text-gray-500">
              Accessory kit
              <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                value={t.accessory_type_id ?? ""} disabled={updateItemType.isPending}
                onChange={(e) => setAccessory(t.id, e.target.value || null)}>
                <option value="">None</option>
                {inventory.data!.filter((o) => o.id !== t.id).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <ul className="flex flex-col gap-1">
              {t.units.map((u) => (
                <li key={u.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <button className="text-left text-gray-600 underline decoration-dotted"
                      onClick={() => setExpandedUnit(expandedUnit === u.id ? null : u.id)}>
                      {u.asset_id ?? u.id.slice(0, 8)}
                    </button>
                    <select className="rounded-lg border border-gray-300 px-2 py-1" defaultValue={u.status}
                      onChange={(e) => setStatus(u.id, e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {expandedUnit === u.id && <UnitHistory unitId={u.id} />}
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

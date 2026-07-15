import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useAddAccessoryKit, useAdminBorrows, useAdminInventory, useCreateUnits, useUnitHistory, useUpdateItemType, useUpdateUnit } from "../hooks/queries";
import { Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { AdminItemType, ReturnQuestion, UnitStatus } from "../lib/types";

const STATUSES: UnitStatus[] = ["available", "in_use", "needs_repair", "retired", "missing"];

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// Current and previous borrowers of one unit, loaded when the row expands.
function UnitHistory({ unitId }: { unitId: string }) {
  const history = useUnitHistory(unitId);
  if (history.isLoading) return <p className="py-1 text-xs text-muted/70">Loading history…</p>;
  if (history.isError) return <p className="py-1 text-xs text-danger">Couldn't load history.</p>;
  if (history.data!.length === 0) return <p className="py-1 text-xs text-muted/70">Never borrowed.</p>;
  return (
    <ul className="flex flex-col gap-1 py-1">
      {history.data!.map((s) => (
        <li key={s.session_id} className="text-xs text-muted">
          <span className="font-medium">{s.full_name ?? s.email}</span>
          {s.full_name && <span className="text-muted/70"> · {s.email}</span>}
          {s.status === "active"
            ? <span className="text-warning"> — has it since {fmt(s.checked_out_at)}</span>
            : <span> — {fmt(s.checked_out_at)} → {s.returned_at ? fmt(s.returned_at) : s.status}</span>}
          {s.return_damaged && (
            <p className="text-danger">Returned damaged{s.return_note ? `: ${s.return_note}` : ""}</p>
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
    <div className="mt-2 rounded-lg bg-surface-2 p-2">
      <ul className="flex flex-col gap-1">
        {draft.map((q, i) => (
          <li key={q.id} className="flex items-center justify-between text-sm text-text">
            <span>
              {q.label}
              <span className="ml-1 text-xs text-muted/70">{q.kind === "yes_no" ? "yes/no" : "text"}{q.flag_if_yes ? " · flags" : ""}</span>
            </span>
            <button className="text-xs text-muted underline"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {draft.length === 0 && <li className="text-xs text-muted/70">No return questions yet.</li>}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="Question label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex items-center gap-3 text-sm text-muted">
          <label className="flex items-center gap-1">
            Answer type
            <select className="rounded-lg border border-edge px-2 py-1" value={kind}
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

// The kit ships in the item's box, so it usually isn't in inventory yet:
// one call creates the kit type + its units and links it to the item.
function AddAccessoryKit({ type }: { type: AdminItemType }) {
  const add = useAddAccessoryKit();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${type.name} Accessory Kit`);
  const [count, setCount] = useState(
    Math.max(type.units.filter((u) => u.status !== "retired").length, 1));

  if (!open) {
    return (
      <button className="mb-2 text-xs text-muted underline" onClick={() => setOpen(true)}>
        + Add accessory kit
      </button>
    );
  }
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg bg-surface-2 p-2">
      <Input aria-label="Kit name" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flex items-center justify-between text-xs text-muted">
        Units
        <input type="number" min={1} max={100} value={count} aria-label="Kit units"
          className="w-20 rounded-lg border border-edge px-2 py-1 text-sm"
          onChange={(e) => setCount(Number(e.target.value))} />
      </label>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={!name.trim() || count < 1 || add.isPending}
          onClick={() => add.mutate({ id: type.id, body: { name: name.trim(), count } }, {
            onSuccess: (r) => { setOpen(false); toast(`Accessory kit created — ${r.created_units} unit${r.created_units === 1 ? "" : "s"}.`); },
            onError: (e) => toast(errorMessage(e), "error"),
          })}>
          {add.isPending ? "Creating…" : "Create kit"}
        </Button>
      </div>
    </div>
  );
}

export function AdminInventoryScreen() {
  const inventory = useAdminInventory();
  const borrows = useAdminBorrows();
  const createUnits = useCreateUnits();
  const updateUnit = useUpdateUnit();
  const updateItemType = useUpdateItemType();
  const toast = useToast();
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [manageType, setManageType] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  if (inventory.isLoading) return <Spinner />;
  if (inventory.isError) return <p className="p-4 text-sm text-muted">Couldn't load inventory.</p>;

  const types = inventory.data!;
  const categories = [...new Set(types.map((t) => t.category))].sort();
  // Who holds each unit right now, for the Assigned To column.
  const holders = new Map(
    (borrows.data?.active ?? []).map((b) => [b.item_unit_id, b.full_name ?? b.email]));

  const term = q.trim().toLowerCase();
  const rows = types.flatMap((t) => t.units.map((u) => ({ u, t })))
    .filter(({ u, t }) =>
      (!term || t.name.toLowerCase().includes(term) || t.category.toLowerCase().includes(term)
        || u.asset_id?.toLowerCase().includes(term))
      && (!category || t.category === category)
      && (!status || u.status === status));
  const emptyTypes = types.filter((t) => t.units.length === 0);
  const managed = manageType ? types.find((t) => t.id === manageType) ?? null : null;

  const setUnitStatus = (id: string, next: string) =>
    updateUnit.mutate({ id, body: { status: next } }, {
      onError: (err) => toast(errorMessage(err), "error"),
    });

  const addUnit = (item_type_id: string) =>
    createUnits.mutate({ item_type_id, count: 1 }, {
      onSuccess: () => toast("Unit added."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  const setAccessory = (id: string, accessory_type_id: string | null) =>
    updateItemType.mutate({ id, body: { accessory_type_id } }, {
      onSuccess: () => toast("Accessory kit updated."),
      onError: (err) => toast(errorMessage(err), "error"),
    });

  return (
    <div className="animate-fade-up py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Total assets</h2>
        <div className="flex items-center gap-3">
          <Link to="/admin/labels" className="text-sm text-muted underline">QR labels</Link>
          <Link to="/admin/add"><Button className="whitespace-nowrap">Add Asset</Button></Link>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 md:flex-row">
        <Input placeholder="Search asset…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}
          className="min-h-[44px] rounded-xl border border-edge bg-surface px-3 text-sm text-text focus:border-primary focus:outline-none">
          <option value="">Category</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}
          className="min-h-[44px] rounded-xl border border-edge bg-surface px-3 text-sm text-text focus:border-primary focus:outline-none">
          <option value="">Status</option>
          {STATUSES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface shadow-sm shadow-black/20">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted/70">
              <th className="px-3 py-2 font-semibold">Asset No</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Category</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Assigned To</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No matching assets.</td></tr>
            )}
            {rows.map(({ u, t }) => (
              <Fragment key={u.id}>
                <tr className="border-t border-edge/40">
                  <td className="px-3 py-2">
                    <button className="font-mono text-xs text-muted underline decoration-dotted"
                      onClick={() => setExpandedUnit(expandedUnit === u.id ? null : u.id)}>
                      {u.asset_id ?? u.id.slice(0, 8)}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-muted">{t.category}</td>
                  <td className="px-3 py-2">
                    <select className="rounded-lg border border-edge bg-surface px-2 py-1 text-xs" defaultValue={u.status}
                      aria-label={`Status for ${u.asset_id ?? t.name}`}
                      onChange={(e) => setUnitStatus(u.id, e.target.value)}>
                      {STATUSES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-muted">{holders.get(u.id) ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-xs text-primary-soft underline" onClick={() => setManageType(t.id)}>
                      Manage type
                    </button>
                  </td>
                </tr>
                {expandedUnit === u.id && (
                  <tr className="border-t border-edge/40 bg-surface-2/50">
                    <td colSpan={6} className="px-3 py-2"><UnitHistory unitId={u.id} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {emptyTypes.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-muted">Types without units</h3>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {emptyTypes.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted">{t.category}{t.notes ? ` · ${t.notes}` : ""}</p>
                </div>
                <button className="text-xs text-primary-soft underline" onClick={() => setManageType(t.id)}>
                  Manage type
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={managed !== null} onClose={() => setManageType(null)}>
        {managed && (
          <div className="max-h-[75vh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-semibold">{managed.name}</h3>
            <p className="mb-3 text-xs text-muted">{managed.category}{managed.notes ? ` · ${managed.notes}` : ""} · {managed.units.length} unit{managed.units.length === 1 ? "" : "s"}</p>
            <Button variant="secondary" className="mb-3 w-full" disabled={createUnits.isPending}
              onClick={() => addUnit(managed.id)}>
              + Add a unit
            </Button>
            <label className="mb-2 flex items-center justify-between gap-2 whitespace-nowrap text-xs text-muted">
              Accessory kit
              <select className="rounded-lg border border-edge bg-surface px-2 py-1 text-sm"
                value={managed.accessory_type_id ?? ""} disabled={updateItemType.isPending}
                onChange={(e) => setAccessory(managed.id, e.target.value || null)}>
                <option value="">None</option>
                {types.filter((o) => o.id !== managed.id).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            {!managed.accessory_type_id && <AddAccessoryKit key={managed.id} type={managed} />}
            <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted/70">Return questions</p>
            <ReturnQuestionsEditor key={`rq-${managed.id}`} type={managed} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

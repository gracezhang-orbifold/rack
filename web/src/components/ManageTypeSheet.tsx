import { useState } from "react";
import { useAddAccessoryKit, useCreateUnits, useUpdateItemType } from "../hooks/queries";
import { Button, Input, useToast } from "./ui";
import { errorMessage } from "../lib/borrowResult";
import type { AdminItemType, ReturnQuestion } from "../lib/types";

// Staged editor for one item type: units, accessory kit, and return
// questions are edited locally and applied together on Done — Cancel
// discards everything. Nothing touches the server until Done.
const CREATE_KIT = "__create__";

function SectionTitle({ children }: { children: string }) {
  return <p className="mb-2 mt-5 border-t border-edge/40 pt-4 text-xs font-semibold uppercase tracking-wide text-muted/70 first:mt-0 first:border-t-0 first:pt-0">{children}</p>;
}

export function ManageTypeSheet({ type, allTypes, onClose }:
  { type: AdminItemType; allTypes: AdminItemType[]; onClose: () => void }) {
  const updateItemType = useUpdateItemType();
  const createUnits = useCreateUnits();
  const addKit = useAddAccessoryKit();
  const toast = useToast();

  // --- staged state ---------------------------------------------------
  const [addUnits, setAddUnits] = useState(0);
  const [kitChoice, setKitChoice] = useState<string>(type.accessory_type_id ?? "");
  const [kitName, setKitName] = useState(`${type.name} Accessory Kit`);
  const [kitCount, setKitCount] = useState(Math.max(type.units.filter((u) => u.status !== "retired").length, 1));
  const [questions, setQuestions] = useState<ReturnQuestion[]>(type.return_questions);
  const [qLabel, setQLabel] = useState("");
  const [qKind, setQKind] = useState<"text" | "yes_no">("text");
  const [qFlag, setQFlag] = useState(false);
  const [busy, setBusy] = useState(false);

  const questionsChanged = JSON.stringify(questions) !== JSON.stringify(type.return_questions);
  const kitChanged = kitChoice !== (type.accessory_type_id ?? "");
  const dirty = addUnits > 0 || kitChanged || questionsChanged;

  const stageQuestion = () => {
    if (!qLabel.trim()) return;
    setQuestions([...questions, {
      id: (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 8),
      label: qLabel.trim(), kind: qKind,
      ...(qKind === "yes_no" && qFlag ? { flag_if_yes: true as const } : {}),
    }]);
    setQLabel(""); setQKind("text"); setQFlag(false);
  };

  // Apply every staged change, in order; keep the sheet open on failure so
  // nothing staged is silently lost.
  const done = async () => {
    if (!dirty) { onClose(); return; }
    setBusy(true);
    try {
      const patch: { return_questions?: ReturnQuestion[]; accessory_type_id?: string | null } = {};
      if (questionsChanged) patch.return_questions = questions;
      if (kitChanged && kitChoice !== CREATE_KIT) patch.accessory_type_id = kitChoice || null;
      if (Object.keys(patch).length) await updateItemType.mutateAsync({ id: type.id, body: patch });
      if (kitChoice === CREATE_KIT) await addKit.mutateAsync({ id: type.id, body: { name: kitName.trim(), count: kitCount } });
      if (addUnits > 0) await createUnits.mutateAsync({ item_type_id: type.id, count: addUnits });
      toast("Changes saved.");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const unitCount = type.units.length;
  const otherTypes = allTypes.filter((o) => o.id !== type.id);

  return (
    <div className="flex max-h-[80vh] flex-col">
      <h3 className="text-lg font-semibold">{type.name}</h3>
      <p className="mb-4 text-xs text-muted">{type.category}{type.notes ? ` · ${type.notes}` : ""}</p>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <SectionTitle>Units</SectionTitle>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{unitCount} unit{unitCount === 1 ? "" : "s"} in inventory</p>
          <div className="flex items-center gap-2" role="group" aria-label="Add units">
            <Button variant="secondary" className="min-w-[44px] px-0" aria-label="Fewer units"
              disabled={addUnits === 0} onClick={() => setAddUnits((n) => Math.max(0, n - 1))}>−</Button>
            <span className="w-14 text-center text-sm" aria-live="polite">+{addUnits}</span>
            <Button variant="secondary" className="min-w-[44px] px-0" aria-label="More units"
              disabled={addUnits >= 100} onClick={() => setAddUnits((n) => n + 1)}>+</Button>
          </div>
        </div>

        <SectionTitle>Accessory kit</SectionTitle>
        <label className="flex items-center justify-between gap-2 whitespace-nowrap text-sm text-muted">
          Ships with
          <select className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-2 py-2 text-sm text-text"
            aria-label="Accessory kit" value={kitChoice} disabled={busy}
            onChange={(e) => setKitChoice(e.target.value)}>
            <option value="">None</option>
            {otherTypes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value={CREATE_KIT}>+ Create a new kit…</option>
          </select>
        </label>
        {kitChoice === CREATE_KIT && (
          <div className="mt-2 flex flex-col gap-2 rounded-xl bg-surface p-3">
            <Input aria-label="Kit name" value={kitName} onChange={(e) => setKitName(e.target.value)} />
            <label className="flex items-center justify-between text-xs text-muted">
              Kit units
              <input type="number" min={1} max={100} value={kitCount} aria-label="Kit units"
                className="w-20 rounded-lg border border-edge bg-surface px-2 py-1 text-sm text-text"
                onChange={(e) => setKitCount(Number(e.target.value))} />
            </label>
          </div>
        )}

        <SectionTitle>Return questions</SectionTitle>
        <ul className="flex flex-col gap-1">
          {questions.map((q, i) => (
            <li key={q.id} className="flex items-center justify-between text-sm text-text">
              <span>
                {q.label}
                <span className="ml-1 text-xs text-muted/70">{q.kind === "yes_no" ? "yes/no" : "text"}{q.flag_if_yes ? " · flags" : ""}</span>
              </span>
              <button className="text-xs text-muted underline" disabled={busy}
                onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
          {questions.length === 0 && <li className="text-xs text-muted/70">No return questions yet.</li>}
        </ul>
        <div className="mt-2 flex flex-col gap-2 rounded-xl bg-surface p-3">
          <Input placeholder="Question label" value={qLabel} onChange={(e) => setQLabel(e.target.value)} />
          <div className="flex items-center gap-3 text-sm text-muted">
            <label className="flex items-center gap-1">
              Answer type
              <select className="rounded-lg border border-edge bg-surface px-2 py-1 text-text" value={qKind}
                onChange={(e) => setQKind(e.target.value as "text" | "yes_no")}>
                <option value="text">text</option>
                <option value="yes_no">yes/no</option>
              </select>
            </label>
            {qKind === "yes_no" && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={qFlag} onChange={(e) => setQFlag(e.target.checked)} />
                Flag for attention if yes
              </label>
            )}
          </div>
          <Button variant="secondary" onClick={stageQuestion} disabled={!qLabel.trim() || busy}>Add question</Button>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-edge/40 pt-4">
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button className="flex-1" disabled={busy || (kitChoice === CREATE_KIT && (!kitName.trim() || kitCount < 1))} onClick={done}>
          {busy ? "Saving…" : dirty ? "Done" : "Close"}
        </Button>
      </div>
    </div>
  );
}

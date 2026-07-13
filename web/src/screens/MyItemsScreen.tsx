import { useState } from "react";
import { useMyBorrows, useReturn } from "../hooks/queries";
import { Badge, Button, Sheet, Spinner, useToast } from "../components/ui";
import { errorMessage } from "../lib/borrowResult";
import type { ActiveBorrow } from "../lib/types";

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

export function MyItemsScreen() {
  const borrows = useMyBorrows();
  const ret = useReturn();
  const toast = useToast();
  const [selected, setSelected] = useState<ActiveBorrow | null>(null);
  const [done, setDone] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const open = (b: ActiveBorrow) => { setSelected(b); setDone(false); ret.reset(); };
  const close = () => { setSelected(null); setDone(false); };
  const confirm = () => {
    if (!selected) return;
    ret.mutate(selected.session_id, {
      onSuccess: () => setDone(true),
      onError: (e) => toast(errorMessage(e), "error"),
    });
  };

  if (borrows.isLoading) return <Spinner />;
  if (borrows.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load your items.</p>;
  const { active, history } = borrows.data!;

  return (
    <div className="py-3">
      <h2 className="mb-3 text-lg font-semibold">Your items</h2>
      {active.length === 0 && <p className="text-sm text-gray-500">Nothing checked out.</p>}
      <ul className="flex flex-col gap-2">
        {active.map((b) => (
          <li key={b.session_id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
            <div>
              <p className="font-medium">{b.item_name}</p>
              {b.is_overdue
                ? <Badge tone="red">Overdue — due {fmt(b.due_at)}</Badge>
                : <span className="text-xs text-gray-500">Due {fmt(b.due_at)}</span>}
            </div>
            <Button variant="secondary" onClick={() => open(b)}>Return</Button>
          </li>
        ))}
      </ul>

      <button className="mt-6 text-sm text-gray-500 underline" onClick={() => setShowHistory((s) => !s)}>
        {showHistory ? "Hide history" : `History (${history.length})`}
      </button>
      {showHistory && (
        <ul className="mt-2 flex flex-col gap-1">
          {history.map((h) => (
            <li key={h.session_id} className="flex justify-between text-sm text-gray-600">
              <span>{h.item_name}</span>
              <span>{h.status}{h.returned_at ? ` · ${fmt(h.returned_at)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={selected !== null} onClose={close}>
        {done ? (
          <div className="text-center">
            <h3 className="mb-1 text-lg font-semibold">Cabinet unlocked</h3>
            <p className="mb-5 text-sm text-gray-600">Put the item back and close the door.</p>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : selected ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return {selected.item_name}?</h3>
            <p className="mb-4 text-sm text-gray-500">The cabinet will unlock so you can put it back.</p>
            {ret.isError && <p className="mb-3 text-sm text-red-600">{errorMessage(ret.error)}</p>}
            <Button className="w-full" disabled={ret.isPending} onClick={confirm}>
              {ret.isPending ? "Unlocking…" : "Confirm & unlock"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

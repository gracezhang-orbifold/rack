import { useState } from "react";
import { useAvailability, useBorrow } from "../hooks/queries";
import { filterInventory, groupByCategory } from "../lib/filter";
import { borrowResultMessage, errorMessage } from "../lib/borrowResult";
import { Badge, Button, Input, Sheet, Spinner, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import type { AvailabilityItem, BorrowResult } from "../lib/types";

const DAY_PRESETS = [1, 3, 7, 14];

export function BrowseScreen() {
  const availability = useAvailability();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AvailabilityItem | null>(null);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<BorrowResult | null>(null);
  const borrow = useBorrow();
  const toast = useToast();

  const openSheet = (item: AvailabilityItem) => { setSelected(item); setDays(7); setResult(null); borrow.reset(); };
  const closeSheet = () => { setSelected(null); setResult(null); };

  const confirm = () => {
    if (!selected) return;
    borrow.mutate({ item_type_id: selected.item_type_id, days }, {
      onSuccess: (r) => setResult(r),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) { toast(errorMessage(e)); closeSheet(); }
      },
    });
  };

  if (availability.isLoading) return <Spinner />;
  if (availability.isError) return <p className="p-4 text-sm text-gray-600">Couldn't load inventory. Pull to refresh.</p>;

  const groups = groupByCategory(filterInventory(availability.data ?? [], q));

  return (
    <div className="pb-4">
      <Input placeholder="Search equipment…" value={q} onChange={(e) => setQ(e.target.value)} className="my-3" />
      {groups.length === 0 && <p className="mt-8 text-center text-sm text-gray-500">No matches.</p>}
      {groups.map(([category, items]) => (
        <section key={category} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{category}</h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.item_type_id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <Badge tone={item.available_units > 0 ? "green" : "gray"}>{item.available_units}/{item.total_units} available</Badge>
                </div>
                <Button disabled={item.available_units === 0} onClick={() => openSheet(item)}>Borrow</Button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Sheet open={selected !== null} onClose={closeSheet}>
        {result ? (
          <div className="text-center">
            <h3 className="mb-1 text-lg font-semibold">{borrowResultMessage(result).title}</h3>
            <p className="mb-5 text-sm text-gray-600">{borrowResultMessage(result).body}</p>
            <Button className="w-full" onClick={closeSheet}>Done</Button>
          </div>
        ) : selected ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Borrow {selected.name}</h3>
            <p className="mb-4 text-sm text-gray-500">How long do you need it?</p>
            <div className="mb-4 flex gap-2">
              {DAY_PRESETS.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}>
                  {d}d
                </button>
              ))}
            </div>
            {borrow.isError && <p className="mb-3 text-sm text-red-600">{errorMessage(borrow.error)}</p>}
            <Button className="w-full" disabled={borrow.isPending} onClick={confirm}>
              {borrow.isPending ? "Unlocking…" : "Confirm & unlock"}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

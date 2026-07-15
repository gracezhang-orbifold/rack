import { Link } from "react-router-dom";
import { useAvailability } from "../hooks/queries";
import { Spinner } from "../components/ui";
import { RequestOptions } from "../components/RequestOptions";

// "Raise New Request": every out-of-stock item with its waitlist / notify /
// reserve actions in one place. In-stock items are borrowed from Dashboard.
export function RaiseRequestScreen() {
  const availability = useAvailability();
  if (availability.isLoading) return <Spinner />;
  if (availability.isError) return <p className="p-4 text-sm text-muted">Couldn't load inventory.</p>;

  const out = (availability.data ?? []).filter((i) => i.available_units === 0 && i.total_units > 0);

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-1 text-lg font-semibold">Raise a request</h2>
      <p className="mb-4 text-sm text-muted">
        These items are out of stock right now. Join the waitlist, get an email when one comes back,
        or reserve a future date. Available items are borrowed from the <Link className="text-primary-soft underline" to="/">Dashboard</Link>.
      </p>
      {out.length === 0 && <p className="text-sm text-muted">Everything is in stock — nothing to request.</p>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {out.map((item) => (
          <li key={item.item_type_id} className="rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <p className="mb-1 font-medium">{item.name}</p>
            <p className="mb-3 text-xs text-muted">{item.category} · 0/{item.total_units} available</p>
            <RequestOptions itemTypeId={item.item_type_id} itemName={item.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useBorrow, useUnitByAsset } from "../hooks/queries";
import { Badge, Button, Spinner } from "../components/ui";
import { RequestOptions } from "../components/RequestOptions";
import { LastReturnNotice } from "../components/LastReturnNotice";
import { borrowResultMessage, errorMessage } from "../lib/borrowResult";
import { ApiError } from "../lib/api";
import type { BorrowResult } from "../lib/types";

const DAY_PRESETS = [1, 3, 7, 14];

// Landing page for a printed QR label: /scan/<asset_id>. Checks out the
// exact unit that was scanned, not just any unit of the same type.
export function ScanScreen() {
  const { assetId = "" } = useParams();
  const unit = useUnitByAsset(assetId);
  const borrow = useBorrow();
  const navigate = useNavigate();
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<BorrowResult | null>(null);

  if (unit.isLoading) return <Spinner />;
  if (unit.isError) {
    const notFound = unit.error instanceof ApiError && unit.error.status === 404;
    return (
      <div className="py-8 text-center">
        <h2 className="mb-1 text-lg font-semibold">{notFound ? "Unknown label" : "Something went wrong"}</h2>
        <p className="text-sm text-gray-600">
          {notFound ? `No item is registered for "${assetId}".` : errorMessage(unit.error)}
        </p>
      </div>
    );
  }
  const u = unit.data!;

  if (result) {
    const msg = borrowResultMessage(result);
    return (
      <div className="py-8 text-center">
        <h2 className="mb-1 text-lg font-semibold">{msg.title}</h2>
        <p className="mb-5 text-sm text-gray-600">{msg.body}</p>
        <LastReturnNotice lastReturn={result.last_return} />
        <Button className="w-full" onClick={() => navigate("/my-items")}>Done</Button>
      </div>
    );
  }

  return (
    <div className="py-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{u.category}</p>
      <h2 className="mb-1 text-lg font-semibold">{u.name}</h2>
      <p className="mb-4"><Badge tone={u.status === "available" ? "green" : "amber"}>{u.asset_id} · {u.status.replace("_", " ")}</Badge></p>

      {u.status === "available" ? (
        <>
          <p className="mb-2 text-sm text-gray-500">How long do you need it?</p>
          <div className="mb-4 flex gap-2">
            {DAY_PRESETS.map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}>
                {d}d
              </button>
            ))}
          </div>
          {borrow.isError && <p className="mb-3 text-sm text-red-600">{errorMessage(borrow.error)}</p>}
          <Button className="w-full" disabled={borrow.isPending}
            onClick={() => borrow.mutate({ item_type_id: u.item_type_id, days, unit_id: u.unit_id }, { onSuccess: setResult })}>
            {borrow.isPending ? "Unlocking…" : "Confirm & unlock"}
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">This unit isn't available right now.</p>
          <RequestOptions itemTypeId={u.item_type_id} itemName={u.name} />
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useRaiseServiceRequest } from "../hooks/queries";
import { Button, Input, useToast } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { parseAssetId } from "../lib/scan";
import { errorMessage } from "../lib/borrowResult";

// "Raise Service Request": something's wrong with a unit — scan its label
// (or type the asset id), describe the problem, and the admins get it.
export function ServiceRequestScreen() {
  const raise = useRaiseServiceRequest();
  const toast = useToast();
  const [assetId, setAssetId] = useState("");
  const [manualId, setManualId] = useState("");
  const [description, setDescription] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onDecoded = (text: string) => {
    const id = parseAssetId(text);
    if (!id) {
      setScanError("That doesn't look like a Rack label — try again or type the ID.");
      setScanKey((k) => k + 1);
      return;
    }
    setScanError(null);
    setAssetId(id);
  };

  const submit = () => {
    if (!assetId || !description.trim()) return;
    raise.mutate({ asset_id: assetId, description: description.trim() }, {
      onSuccess: (r) => { setDone(r.asset_id); },
      onError: (e) => toast(errorMessage(e), "error"),
    });
  };

  if (done) {
    return (
      <div className="animate-fade-up py-8 text-center">
        <h2 className="mb-1 text-lg font-semibold">Request sent</h2>
        <p className="mb-5 text-sm text-muted">
          The admins have been notified about <span className="font-mono">{done}</span>.
          Track it under <Link className="text-primary-soft underline" to="/requests">View Request Status</Link>.
        </p>
        <Button className="w-full md:w-auto" onClick={() => { setDone(null); setAssetId(""); setManualId(""); setDescription(""); }}>
          Report another item
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-1 text-lg font-semibold">Raise a service request</h2>
      <p className="mb-4 text-sm text-muted">Something broken or missing? Scan the item's label or type its ID, then describe the problem.</p>

      <div className="max-w-md">
        {!assetId ? (
          <>
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <Input placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId)}
                onClick={() => { setAssetId(parseAssetId(manualId)!); setScanError(null); }}>
                Use ID
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-danger">{scanError}</p>}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm">
              Reporting <span className="font-mono text-primary-soft">{assetId}</span>{" "}
              <button className="text-xs text-muted underline" onClick={() => { setAssetId(""); setManualId(""); }}>change</button>
            </p>
            <label className="text-sm text-text">
              What's wrong?
              <textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem"
                className="mt-1 w-full rounded-xl border border-edge bg-surface p-3 text-sm text-text placeholder:text-muted/80 focus:border-primary focus:outline-none" />
            </label>
            <Button className="mt-3 w-full" disabled={!description.trim() || raise.isPending} onClick={submit}>
              {raise.isPending ? "Sending…" : "Send service request"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

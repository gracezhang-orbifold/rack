import { useState } from "react";
import {
  useConfirmBorrow, useExtend, useMyBorrows, useReturn, useSaveDraftAnswers,
  useSettings, useUnlockBorrow, useUpdateSettings,
} from "../hooks/queries";
import { Badge, Button, Sheet, Spinner, useToast } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { errorMessage } from "../lib/borrowResult";
import { parseAssetId } from "../lib/scan";
import { api, ApiError } from "../lib/api";
import { isIOS, isStandalone, pushSupported, subscribeToPush } from "../lib/push";
import type { ActiveBorrow, ReturnAnswers } from "../lib/types";

const EXTEND_PRESETS = [1, 3, 7, 14];

function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }); }

// Reminder emails: heads-up N days before due, overdue nag cadence.
function ReminderSettingsCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  // Custom heads-up editor state ("N hours/days before"); null = using a preset.
  const [custom, setCustom] = useState<{ amount: string; unit: "hours" | "days" } | null>(null);
  if (!settings.data || typeof settings.data.remind_before_minutes !== "number") return null;
  const lead = settings.data.remind_before_minutes;
  const customMinutes = custom ? Number(custom.amount) * (custom.unit === "days" ? 1440 : 60) : 0;
  const customValid = custom !== null && Number.isInteger(Number(custom.amount))
    && Number(custom.amount) >= 1 && customMinutes <= 14 * 1440;
  const save = (body: Parameters<typeof update.mutate>[0]) =>
    update.mutate(body, {
      onSuccess: () => toast("Reminder settings saved."),
      onError: (e) => toast(errorMessage(e), "error"),
    });
  // Push is offered only where the browser can actually deliver it. On iOS
  // the Push API exists solely inside an installed (Home Screen) PWA, so
  // this check is also the "installed app only" gate.
  const canPush = pushSupported() && Boolean(settings.data.vapid_public_key);
  const chooseChannel = async (channel: "email" | "push") => {
    if (channel === "email") return save({ reminder_channel: "email" });
    try {
      const sub = await subscribeToPush(settings.data!.vapid_public_key);
      await api.pushSubscribe(sub);
      save({ reminder_channel: "push" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "couldn't enable push notifications", "error");
    }
  };
  return (
    <div className="mt-6 rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
      <p className="mb-2 text-sm font-medium">Reminders</p>
      <label className="mb-2 flex items-center justify-between text-sm text-muted">
        Remind me by
        <select className="rounded-lg border border-edge px-2 py-1"
          value={settings.data.reminder_channel} disabled={update.isPending}
          onChange={(e) => chooseChannel(e.target.value as "email" | "push")}>
          <option value="email">Email</option>
          {(canPush || settings.data.reminder_channel === "push") && (
            <option value="push">Push notification</option>
          )}
        </select>
      </label>
      {!canPush && isIOS() && !isStandalone() && (
        <p className="mb-2 text-xs text-muted/70">
          Want push notifications? Install Rack first (Share → Add to Home Screen), then pick push here.
        </p>
      )}
      <label className="mb-2 flex items-center justify-between text-sm text-muted">
        Heads-up before due
        <select className="rounded-lg border border-edge px-2 py-1"
          value={custom ? "custom" : ["0", "60", "1440"].includes(String(lead)) ? String(lead) : "custom"}
          disabled={update.isPending}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setCustom(lead > 0 && lead % 1440 === 0
                ? { amount: String(lead / 1440), unit: "days" }
                : { amount: String(Math.max(1, Math.round(lead / 60))), unit: "hours" });
            } else {
              setCustom(null);
              save({ remind_before_minutes: Number(e.target.value) });
            }
          }}>
          <option value="0">Off</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
          <option value="custom">Custom…</option>
        </select>
      </label>
      {custom && (
        <div className="mb-2 flex items-center justify-end gap-2 text-sm text-muted">
          <input type="number" min={1} aria-label="Heads-up amount"
            className="w-20 rounded-lg border border-edge px-2 py-1"
            value={custom.amount}
            onChange={(e) => setCustom({ ...custom, amount: e.target.value })} />
          <select className="rounded-lg border border-edge px-2 py-1" aria-label="Heads-up unit"
            value={custom.unit}
            onChange={(e) => setCustom({ ...custom, unit: e.target.value as "hours" | "days" })}>
            <option value="hours">hours before</option>
            <option value="days">days before</option>
          </select>
          <Button variant="secondary" disabled={!customValid || update.isPending}
            onClick={() => { save({ remind_before_minutes: customMinutes }); setCustom(null); }}>
            Set
          </Button>
        </div>
      )}
      <label className="flex items-center justify-between text-sm text-muted">
        Overdue reminders
        <select className="rounded-lg border border-edge px-2 py-1"
          value={settings.data.overdue_reminder_every_days} disabled={update.isPending}
          onChange={(e) => save({ overdue_reminder_every_days: Number(e.target.value) })}>
          <option value={0}>Off</option>
          <option value={1}>Daily</option>
          <option value={3}>Every 3 days</option>
          <option value={7}>Weekly</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted/70">
        Reminders arrive within a few minutes of falling due; you also get one the moment an item is due.
      </p>
    </div>
  );
}

export function MyItemsScreen() {
  const borrows = useMyBorrows();
  const ret = useReturn();
  const saveDraft = useSaveDraftAnswers();
  const extend = useExtend();
  const confirmUnit = useConfirmBorrow();
  const unlock = useUnlockBorrow();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ kind: "menu" | "return" | "extend" | "confirm" | "questions"; b: ActiveBorrow } | null>(null);
  const [done, setDone] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [days, setDays] = useState(7);
  const [manualId, setManualId] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState("");
  // Labeled return: the scanned/typed asset id, held while the user picks
  // how to open the cabinet (unlock now vs. keypad code).
  const [returnAsset, setReturnAsset] = useState<string | null>(null);
  const [answers, setAnswers] = useState<ReturnAnswers>({});

  const open = (kind: "menu" | "return" | "extend" | "confirm" | "questions", b: ActiveBorrow) => {
    setSheet({ kind, b }); setDone(false); setDays(7);
    setManualId(""); setScanError(null);
    setDamaged(false); setNote(""); setReturnAsset(null);
    // Returning (or pre-answering) starts from any saved draft, so answers
    // only need confirming instead of retyping.
    setAnswers(kind === "return" || kind === "questions" ? ((b.draft_answers as ReturnAnswers) ?? {}) : {});
    ret.reset(); extend.reset(); confirmUnit.reset();
  };
  const close = () => { setSheet(null); setDone(false); };

  const conditionIncomplete = damaged && !note.trim();

  const questions = sheet?.b.return_questions ?? [];
  const setAnswer = (id: string, v: string | boolean) => setAnswers((a) => ({ ...a, [id]: v }));
  const questionsIncomplete = questions.some((q) => q.kind === "yes_no" && typeof answers[q.id] !== "boolean");
  const returnIncomplete = conditionIncomplete || questionsIncomplete;

  const questionFields = questions.length > 0 && (
    <div className="mb-3 flex flex-col gap-3">
      {questions.map((q) =>
        q.kind === "yes_no" ? (
          <div key={q.id}>
            <p className="mb-1 text-sm text-text">{q.label}</p>
            <div className="flex gap-2" role="group" aria-label={q.label}>
              {[true, false].map((v) => (
                <button key={String(v)} type="button" onClick={() => setAnswer(q.id, v)}
                  aria-pressed={answers[q.id] === v}
                  className={`min-h-[44px] flex-1 rounded-xl border ${answers[q.id] === v ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label key={q.id} className="text-sm text-text">
            {q.label}
            <textarea rows={2} maxLength={500} value={(answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              className="mt-1 w-full rounded-xl border border-edge p-3 text-sm focus:border-primary focus:outline-none" />
          </label>
        ))}
    </div>
  );

  const doReturn = (asset_id?: string, access?: "unlock" | "code") => {
    if (!sheet) return;
    const cleanAnswers = Object.fromEntries(
      Object.entries(answers)
        .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v] as const)
        .filter(([, v]) => v !== ""));
    ret.mutate({
      session_id: sheet.b.session_id, asset_id, damaged, note: note.trim() || undefined,
      answers: Object.keys(cleanAnswers).length ? cleanAnswers : undefined,
      access: access === "code" ? "code" : undefined,
    }, {
      onSuccess: () => setDone(true),
      onError: (e) => {
        const msg = e instanceof ApiError ? e.message : errorMessage(e);
        if (sheet.b.asset_id) { setReturnAsset(null); setScanError(msg); setScanKey((k) => k + 1); }
        else toast(msg, "error");
      },
    });
  };
  // Labeled returns capture the label first; the unlock-method choice follows.
  const captureReturnAsset = (assetId: string) => {
    if (sheet?.b.asset_id && assetId !== sheet.b.asset_id) {
      setScanError(`That label doesn't match — this loan is for ${sheet.b.asset_id}.`);
      setScanKey((k) => k + 1);
      return;
    }
    setScanError(null);
    setReturnAsset(assetId);
  };
  const doConfirmUnit = (asset_id: string) => {
    if (!sheet) return;
    confirmUnit.mutate({ session_id: sheet.b.session_id, asset_id }, {
      onSuccess: (r) => { toast(`Confirmed — you have ${r.asset_id}.`); close(); },
      onError: (e) => {
        setScanError(e instanceof ApiError ? e.message : errorMessage(e));
        setScanKey((k) => k + 1);
      },
    });
  };
  const onDecoded = (text: string) => {
    if (sheet?.kind === "return" && returnIncomplete) {
      setScanError("Answer the return questions first, then scan again.");
      setScanKey((k) => k + 1);
      return;
    }
    const assetId = parseAssetId(text);
    if (!assetId) {
      setScanError("That doesn't look like a Rack label — try again or type the ID.");
      setScanKey((k) => k + 1);
      return;
    }
    setScanError(null);
    if (sheet?.kind === "confirm") doConfirmUnit(assetId);
    else captureReturnAsset(assetId);
  };

  const conditionFields = (
    <div className="mb-3">
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" className="h-4 w-4" checked={damaged}
          onChange={(e) => setDamaged(e.target.checked)} />
        The item is damaged
      </label>
      {damaged && (
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Describe the damage (required)"
          className="mt-2 w-full rounded-xl border border-edge p-3 text-sm focus:border-primary focus:outline-none" />
      )}
    </div>
  );
  const doExtend = () => {
    if (!sheet) return;
    extend.mutate({ session_id: sheet.b.session_id, days }, {
      onSuccess: (r) => { toast(`Extended — now due ${fmt(r.due_at)}.`); close(); },
      onError: (e) => toast(e instanceof ApiError ? e.message : errorMessage(e), "error"),
    });
  };

  if (borrows.isLoading) return <Spinner />;
  if (borrows.isError) return <p className="p-4 text-sm text-muted">Couldn't load your items.</p>;
  const { active, history } = borrows.data!;

  return (
    <div className="animate-fade-up py-3">
      <h2 className="mb-3 text-lg font-semibold">Your items</h2>
      {active.length === 0 && <p className="text-sm text-muted">Nothing checked out.</p>}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {active.map((b) => (
          <li key={b.session_id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-sm shadow-black/20">
            <div>
              <p className="font-medium">{b.item_name}{b.asset_id ? <span className="font-mono text-xs text-muted/70"> · {b.asset_id}</span> : null}</p>
              {!b.unit_confirmed
                ? <Badge tone="amber">Scan needed — confirm which unit you took</Badge>
                : b.is_overdue
                  ? <Badge tone="red">Overdue — due {fmt(b.due_at)}</Badge>
                  : <span className="text-xs text-muted">Due {fmt(b.due_at)}</span>}
              {b.access_code && b.access_code_expires_at && new Date(b.access_code_expires_at) > new Date() && (
                <p className="text-xs text-muted">
                  Cabinet code <span className="font-mono font-semibold text-text">{b.access_code}</span>
                  {" "}· works until {fmt(b.access_code_expires_at)}
                </p>
              )}
            </div>
            <button aria-label={`More options for ${b.item_name}`}
              className="min-h-[44px] min-w-[44px] rounded-xl text-xl font-bold text-muted active:bg-surface-2"
              onClick={() => open("menu", b)}>
              ⋯
            </button>
          </li>
        ))}
      </ul>

      <ReminderSettingsCard />

      <button className="mt-6 text-sm text-muted underline" onClick={() => setShowHistory((s) => !s)}>
        {showHistory ? "Hide history" : `History (${history.length})`}
      </button>
      {showHistory && (
        <ul className="mt-2 flex flex-col gap-2">
          {history.map((h) => (
            <li key={h.session_id} className="text-sm text-muted">
              <div className="flex justify-between">
                <span>{h.item_name}{h.asset_id ? <span className="font-mono text-xs text-muted/70"> · {h.asset_id}</span> : null}</span>
                <span>{h.status}</span>
              </div>
              <p className="text-xs text-muted/70">
                Borrowed {fmt(h.checked_out_at)}{h.returned_at ? ` — returned ${fmt(h.returned_at)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={sheet !== null} onClose={close}>
        {done ? (
          <div className="text-center">
            {ret.data?.access_code ? (
              <>
                <h3 className="mb-1 text-lg font-semibold">Your return code</h3>
                <p className="my-4 font-mono text-4xl font-bold tracking-[0.3em]">{ret.data.access_code.code}</p>
                <p className="mb-2 text-sm text-muted">
                  Type it on the cabinet keypad, then press <span className="font-mono">#</span>, and put the item back.
                  Valid until {new Date(ret.data.access_code.ends_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
                  {damaged
                    ? " The admins have been notified and the unit is marked for repair."
                    : ret.data.flagged ? " Your notes were sent to the admins." : ""}
                </p>
                <p className="mb-5 text-xs text-muted/70">
                  Heads-up: the code takes about 30 minutes to start working on the keypad.
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-semibold">{damaged ? "Damage reported" : "Cabinet unlocked"}</h3>
                <p className="mb-5 text-sm text-muted">
                  {damaged
                    ? "Put the item back and close the door — the admins have been notified and the unit is marked for repair."
                    : ret.data?.flagged
                      ? "Put the item back and close the door — your notes were sent to the admins."
                      : "Put the item back and close the door."}
                </p>
              </>
            )}
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : sheet?.kind === "menu" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">{sheet.b.item_name}</h3>
            <p className="mb-3 text-sm text-muted">
              {sheet.b.asset_id ? <span className="font-mono">{sheet.b.asset_id} · </span> : null}
              Due {fmt(sheet.b.due_at)}
            </p>
            <div className="flex flex-col gap-2">
              {!sheet.b.unit_confirmed && (
                <Button onClick={() => open("confirm", sheet.b)}>Scan ID</Button>
              )}
              {sheet.b.access_code && (
                <Button variant="secondary" disabled={unlock.isPending}
                  onClick={() => unlock.mutate({ session_id: sheet.b.session_id }, {
                    onSuccess: () => { toast("Cabinet unlocked — take the key."); close(); },
                    onError: (e) => toast(e instanceof ApiError ? e.message : errorMessage(e), "error"),
                  })}>
                  {unlock.isPending ? "Unlocking…" : "Unlock cabinet"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => open("return", sheet.b)}>Return</Button>
              {(sheet.b.return_questions?.length ?? 0) > 0 && (
                <Button variant="secondary" onClick={() => open("questions", sheet.b)}>Answer return questions</Button>
              )}
              <Button variant="secondary" onClick={() => open("extend", sheet.b)}>Extend deadline</Button>
            </div>
          </div>
        ) : sheet?.kind === "confirm" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Which {sheet.b.item_name} did you take?</h3>
            <p className="mb-3 text-sm text-muted">
              Scan the QR label on the item in your hands (or type its ID). You can't borrow anything
              else until this checkout is confirmed.
            </p>
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <input className="min-h-[44px] w-full rounded-xl border border-edge px-3 focus:border-primary focus:outline-none"
                placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || confirmUnit.isPending}
                onClick={() => doConfirmUnit(parseAssetId(manualId)!)}>
                {confirmUnit.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-danger">{scanError}</p>}
          </div>
        ) : sheet?.kind === "questions" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return questions — {sheet.b.item_name}</h3>
            <p className="mb-3 text-sm text-muted">
              Answer now, return later: your answers are saved and prefilled when you return the item.
              Partial answers are fine.
            </p>
            {questionFields}
            <Button className="w-full" disabled={saveDraft.isPending}
              onClick={() => saveDraft.mutate({ session_id: sheet.b.session_id, answers }, {
                onSuccess: () => { toast("Answers saved — they'll be prefilled at return."); close(); },
                onError: (e) => toast(e instanceof ApiError ? e.message : errorMessage(e), "error"),
              })}>
              {saveDraft.isPending ? "Saving…" : "Save answers"}
            </Button>
          </div>
        ) : sheet?.kind === "extend" ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Extend {sheet.b.item_name}</h3>
            <p className="mb-4 text-sm text-muted">Currently due {fmt(sheet.b.due_at)}. Extend by how long?</p>
            <div className="mb-4 flex gap-2">
              {EXTEND_PRESETS.map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${days === d ? "border-primary bg-primary text-on-primary" : "border-edge"}`}>
                  +{d}d
                </button>
              ))}
            </div>
            <Button className="w-full" disabled={extend.isPending} onClick={doExtend}>
              {extend.isPending ? "Extending…" : "Extend loan"}
            </Button>
          </div>
        ) : sheet?.kind === "return" && sheet.b.asset_id && returnAsset ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Label confirmed</h3>
            <p className="mb-4 text-sm text-muted">
              <span className="font-mono">{returnAsset}</span> checks out. How do you want to open the cabinet?
            </p>
            <div className="flex flex-col gap-2">
              <Button className="w-full" disabled={ret.isPending}
                onClick={() => doReturn(returnAsset, "unlock")}>
                {ret.isPending ? "Working…" : "Unlock now"}
              </Button>
              <Button variant="secondary" className="w-full" disabled={ret.isPending}
                onClick={() => doReturn(returnAsset, "code")}>
                Get a code to unlock later
              </Button>
              <p className="text-center text-xs text-muted/70">
                A code works on the cabinet keypad for 24 hours, but takes about 30 minutes to start working.
              </p>
            </div>
          </div>
        ) : sheet?.kind === "return" && sheet.b.asset_id ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return {sheet.b.item_name}?</h3>
            <p className="mb-3 text-sm text-muted">
              Scan the label on the item (<span className="font-mono">{sheet.b.asset_id}</span>) to confirm.
            </p>
            {questionFields}
            {conditionFields}
            <QrScanner key={scanKey} onScan={onDecoded} />
            <div className="mt-3 flex gap-2">
              <input className="min-h-[44px] w-full rounded-xl border border-edge px-3 focus:border-primary focus:outline-none"
                placeholder="…or type the asset ID" value={manualId}
                onChange={(e) => setManualId(e.target.value)} />
              <Button variant="secondary" disabled={!parseAssetId(manualId) || returnIncomplete || ret.isPending}
                onClick={() => captureReturnAsset(parseAssetId(manualId)!)}>
                {ret.isPending ? "…" : "Confirm"}
              </Button>
            </div>
            {scanError && <p className="mt-2 text-sm text-danger">{scanError}</p>}
          </div>
        ) : sheet ? (
          <div>
            <h3 className="mb-1 text-lg font-semibold">Return {sheet.b.item_name}?</h3>
            <p className="mb-4 text-sm text-muted">How do you want to open the cabinet?</p>
            {questionFields}
            {conditionFields}
            {ret.isError && <p className="mb-3 text-sm text-danger">{errorMessage(ret.error)}</p>}
            <div className="flex flex-col gap-2">
              <Button className="w-full" disabled={ret.isPending || returnIncomplete}
                onClick={() => doReturn(undefined, "unlock")}>
                {ret.isPending ? "Working…" : "Unlock now"}
              </Button>
              <Button variant="secondary" className="w-full" disabled={ret.isPending || returnIncomplete}
                onClick={() => doReturn(undefined, "code")}>
                Get a code to unlock later
              </Button>
              <p className="text-center text-xs text-muted/70">
                A code works on the cabinet keypad for 24 hours, but takes about 30 minutes to start working.
              </p>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

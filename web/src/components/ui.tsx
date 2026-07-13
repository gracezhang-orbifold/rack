import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "min-h-[44px] px-4 rounded-xl font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
  const styles = {
    primary: "bg-gray-900 text-white active:bg-gray-700",
    secondary: "bg-gray-200 text-gray-900 active:bg-gray-300",
    danger: "bg-red-600 text-white active:bg-red-700",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) {
  const styles = {
    gray: "bg-gray-100 text-gray-700", green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`min-h-[44px] w-full rounded-xl border border-gray-300 px-3 focus:border-gray-900 focus:outline-none ${className}`} {...props} />;
}

export function Spinner() {
  return <div className="mx-auto my-8 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" role="status" aria-label="Loading" />;
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8" role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

interface ToastState { id: number; message: string; tone: "info" | "error"; }
const ToastCtx = createContext<(message: string, tone?: "info" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const push = useCallback((message: string, tone: "info" | "error" = "info") => {
    const id = Date.now() + Math.floor(performance.now());
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={`w-full max-w-md rounded-xl px-4 py-3 text-sm text-white shadow-lg ${t.tone === "error" ? "bg-red-600" : "bg-gray-900"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Button({ variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "min-h-[44px] px-4 rounded-xl font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,transform] active:scale-[0.98]";
  const styles = {
    primary: "bg-primary text-on-primary active:bg-primary-strong",
    secondary: "bg-surface-2 text-text active:bg-edge",
    danger: "bg-danger text-bg active:bg-danger/80",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) {
  const styles = {
    gray: "bg-text/10 text-muted",
    green: "bg-success/15 text-success",
    red: "bg-danger/15 text-danger",
    amber: "bg-warning/15 text-warning",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`min-h-[44px] w-full rounded-xl border border-edge bg-surface px-3 text-text placeholder:text-muted/80 transition-colors focus:border-primary focus:outline-none ${className}`} {...props} />;
}

// Shared card surface — replaces the old inline `rounded-xl bg-white p-3
// shadow-sm` sprinkled across screens. Borders stay off cards on purpose;
// surface contrast + shadow do the separating.
export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl bg-surface p-3 shadow-sm shadow-black/20 ${className}`} {...props} />;
}

export function Spinner() {
  return <div className="mx-auto my-8 h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-primary" role="status" aria-label="Loading" />;
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  // Portal to <body>: screens animate with transforms, and a transformed
  // ancestor would trap this fixed overlay inside the content column.
  return createPortal(
    <div className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md animate-sheet-up rounded-t-2xl bg-surface-2 p-5 pb-8 shadow-lg shadow-black/40 md:animate-modal-in md:rounded-2xl md:pb-5"
        role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const THEME_COLORS = { dark: "#070C2B", light: "#F4EDDD" } as const;

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rack-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[next]);
  };
  return (
    <button aria-label="Switch theme" onClick={toggle}
      className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2">
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
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
      {createPortal(
      <div className="fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={`w-full max-w-md animate-fade-up rounded-xl px-4 py-3 text-sm shadow-lg shadow-black/30 ${t.tone === "error" ? "bg-danger text-bg" : "bg-surface-2 text-text"}`}>
            {t.message}
          </div>
        ))}
      </div>,
      document.body)}
    </ToastCtx.Provider>
  );
}

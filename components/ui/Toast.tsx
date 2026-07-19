"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  leaving: boolean;
}

interface ToastContextValue {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Errors linger a bit longer than a confirmation -- worth the extra second
// to actually read, not just register that something flashed by.
const DURATION_MS: Record<ToastType, number> = {
  error: 6000,
  success: 4000,
  info: 4000,
};
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = idRef.current++;
      setToasts((prev) => [...prev, { id, type, message, leaving: false }]);
      setTimeout(() => dismiss(id), DURATION_MS[type]);
    },
    [dismiss],
  );

  const [value] = useState<ToastContextValue>(() => ({
    error: (message: string) => push("error", message),
    success: (message: string) => push("success", message),
    info: (message: string) => push("info", message),
  }));

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// Popup notifications for transient events (errors, confirmations) so they
// stop eating layout space and shifting the surrounding UI -- see
// components/settings/ProfileSection.tsx etc. for call sites. Persistent
// in-context state (a round's "time's up" label, a full-page "match failed
// to load" state) stays inline; those aren't one-off notifications.
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TYPE_ACCENT: Record<ToastType, string> = {
  error: "border-l-red-400",
  success: "border-l-correct",
  info: "border-l-border",
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);

  // Same mount-then-flip trick as Modal.tsx: start off-screen/transparent,
  // flip to the resting state one frame later so the transition actually
  // has something to animate between.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const shown = visible && !toast.leaving;

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border border-l-4 bg-surface px-4 py-3 shadow-lg transition duration-200 motion-reduce:transition-none ${TYPE_ACCENT[toast.type]} ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <p className="flex-1 text-sm font-medium text-text">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// toasts starts empty and only ever grows from a client-triggered push(), so
// this is null on the server and the very first client render -- safe to
// reach for document.body without an SSR guard, same reasoning as Modal.tsx.
function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

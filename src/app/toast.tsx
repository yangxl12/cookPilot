import { useEffect, useSyncExternalStore } from 'react';
import { CircleAlert, X } from 'lucide-react';

export type Toast = { text: string; tone: 'info' | 'success' | 'error' };

// The toast lives outside React state: showing or clearing it must never re-render the app tree.
let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function notify(text: string, tone: Toast['tone'] = 'info') {
  current = { text, tone };
  publish();
  clearTimeout(timer);
  timer = setTimeout(dismissToast, tone === 'error' ? 9000 : 2200);
}

export function dismissToast() {
  clearTimeout(timer);
  if (!current) return;
  current = null;
  publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ToastHost() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => () => clearTimeout(timer), []);
  if (!toast) return null;
  return toast.tone === 'error' ? (
    <div className="toast toast-error" role="alert">
      <CircleAlert size={19} aria-hidden="true" />
      <span>{toast.text}</span>
      <button className="icon-button" aria-label="关闭提示" onClick={dismissToast}>
        <X size={16} />
      </button>
    </div>
  ) : (
    <div className="toast-soft" role="status">
      {toast.text}
    </div>
  );
}

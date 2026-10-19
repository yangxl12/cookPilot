import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    (element?.querySelector<HTMLElement>('[data-autofocus]') ?? element)?.focus();
    const backgrounds = [
      document.getElementById('app-content'),
      document.getElementById('composer-host'),
    ].filter((node): node is HTMLElement => node !== null);
    for (const node of backgrounds) node.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab' && element) {
        const focusable = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select, a[href], [tabindex="0"]',
          ),
        ].filter((e) => e.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === element)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === element)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      for (const node of backgrounds) node.inert = false;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="sheet-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

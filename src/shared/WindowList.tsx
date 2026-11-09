import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** Variable-height window with measured spacers. A focused row stays mounted until
 * focus leaves it; other rows are bounded independently of scroll distance. */
export function WindowList<T extends { id: string }>({
  items,
  render,
  estimate = 130,
  onEnd,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  estimate?: number;
  onEnd?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 24 });
  const pendingFocus = useRef<string | undefined>(undefined);
  const offsets = useMemo(() => {
    const offsets = [0];
    for (const item of items)
      offsets.push(offsets.at(-1)! + (heights.current.get(item.id) ?? estimate));
    return offsets;
  }, [items, estimate, revision]);
  useLayoutEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    for (const id of heights.current.keys()) if (!ids.has(id)) heights.current.delete(id);
  }, [items]);
  useLayoutEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = host.current;
        if (!element) return;
        const top = -element.getBoundingClientRect().top;
        let first = 0;
        while (first < items.length && offsets[first + 1] < Math.max(0, top)) first++;
        let last = first;
        while (last < items.length && offsets[last] < top + window.innerHeight) last++;
        const start = Math.max(0, first - 4);
        const end = Math.min(items.length, Math.max(last + 4, start + 24));
        setRange((old) => (old.start === start && old.end === end ? old : { start, end }));
        if (end >= items.length && top + window.innerHeight >= offsets.at(-1)! - 400) onEnd?.();
      });
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [items.length, offsets, onEnd]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.rowId!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0 && Math.abs((heights.current.get(id) ?? estimate) - height) > 1) {
          heights.current.set(id, height);
          changed = true;
        }
      }
      if (changed) setRevision((r) => r + 1);
    });
    host.current.querySelectorAll('[data-row-id]').forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [range, items, estimate]);
  // Keep at most one additional focused row. Its measured slot remains in place.
  const focusId =
    typeof document !== 'undefined'
      ? document.activeElement?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
      : undefined;
  const start = Math.min(range.start, Math.max(0, items.length - 1));
  const end = Math.min(items.length, Math.max(start + 24, range.end));
  const focused = items.findIndex((item) => item.id === focusId);
  useLayoutEffect(() => {
    if (!pendingFocus.current || !host.current) return;
    const element = [...host.current.querySelectorAll<HTMLElement>('[data-row-id]')].find(
      (row) => row.dataset.rowId === pendingFocus.current,
    );
    element?.querySelector<HTMLElement>('button, a, input, [tabindex="0"]')?.focus();
    pendingFocus.current = undefined;
  }, [range]);
  const row = (item: T) => (
    <div
      key={item.id}
      data-row-id={item.id}
      role="listitem"
      aria-posinset={items.indexOf(item) + 1}
      aria-setsize={items.length}
      style={{ display: 'flow-root' }}
    >
      {render(item)}
    </div>
  );
  const gap = (from: number, to: number) => (
    <div
      aria-hidden="true"
      style={{ height: offsets[to] - offsets[from], pointerEvents: 'none' }}
    />
  );
  return (
    <div
      ref={host}
      className="window-list"
      role="list"
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement;
        const current = target.closest<HTMLElement>('[data-row-id]');
        const index = items.findIndex((item) => item.id === current?.dataset.rowId);
        const controls = current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a, input, [tabindex="0"]',
        );
        const next = event.shiftKey ? index - 1 : index + 1;
        const edge = event.shiftKey ? controls?.[0] : controls?.[controls.length - 1];
        if (target !== edge || next < 0 || next >= items.length || (next >= start && next < end))
          return;
        event.preventDefault();
        pendingFocus.current = items[next].id;
        setRange({ start: Math.max(0, next - 4), end: Math.min(items.length, next + 24) });
      }}
    >
      {focused >= 0 && focused < start ? (
        <>
          {gap(0, focused)}
          {row(items[focused])}
          {gap(focused + 1, start)}
        </>
      ) : (
        gap(0, start)
      )}
      {items.slice(start, end).map(row)}
      {focused >= end ? (
        <>
          {gap(end, focused)}
          {row(items[focused])}
          {gap(focused + 1, items.length)}
        </>
      ) : (
        gap(end, items.length)
      )}
    </div>
  );
}

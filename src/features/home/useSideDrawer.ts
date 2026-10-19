import { useCallback, useEffect, useRef, useState } from 'react';

const EDGE = 28;
const LOCK_AT = 0.4;
const FLICK = 0.32; // px per millisecond
const SLOP = 6;

type Gesture = {
  id: number;
  x: number;
  y: number;
  from: number;
  axis: 'x' | 'y' | null;
  lastX: number;
  lastAt: number;
  velocity: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Side drawer that pushes the page instead of covering it, with a 1:1 touch
 * gesture: drag from the left edge to open, drag left anywhere to close.
 * Offsets live on the `.app` element as `--drawer-x`, so the surface, the
 * composer and the floating timer all move in the same frame.
 */
export function useSideDrawer(disabled = false) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const offset = useRef(0);
  const openRef = useRef(open);
  const disabledRef = useRef(disabled);
  const gesture = useRef<Gesture | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  openRef.current = open;
  disabledRef.current = disabled;

  const paint = useCallback((x: number, dragging: boolean) => {
    const element = appRef.current;
    if (!element) return;
    offset.current = x;
    element.style.setProperty('--drawer-x', `${x.toFixed(2)}px`);
    if (dragging) element.dataset.dragging = '';
    else delete element.dataset.dragging;
  }, []);

  const measure = useCallback(() => {
    width.current = drawerRef.current?.offsetWidth ?? 0;
    return width.current;
  }, []);

  const show = useCallback(() => {
    clearTimeout(settle.current);
    setClosing(false);
    measure();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)
      document.activeElement.blur();
    setOpen(true);
    paint(width.current, false);
  }, [measure, paint]);

  const hide = useCallback(() => {
    if (!openRef.current) return;
    setOpen(false);
    setClosing(true);
    paint(0, false);
    clearTimeout(settle.current);
    // Keep the panel painted while the page slides back over it.
    settle.current = setTimeout(() => setClosing(false), 380);
  }, [paint]);

  const painted = useCallback(() => {
    const surface = appRef.current?.querySelector<HTMLElement>('.app-surface');
    const transform = surface ? getComputedStyle(surface).transform : 'none';
    if (!transform || transform === 'none') return 0;
    try {
      return new DOMMatrixReadOnly(transform).m41;
    } catch {
      return offset.current;
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || gesture.current) return;
      const element = appRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const touch = event.touches[0];
      if (touch.clientX < rect.left || touch.clientX > rect.right) return;
      const opened = openRef.current;
      if (!opened && touch.clientX - rect.left > EDGE) return;
      if (!width.current) measure();
      gesture.current = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        from: painted(),
        axis: null,
        lastX: touch.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };
    };
    const move = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === current.id);
      if (!touch) return;
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (!current.axis) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (current.axis === 'y') {
          gesture.current = null;
          return;
        }
        paint(current.from, true);
      }
      if (current.axis !== 'x') return;
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - current.lastAt;
      if (elapsed > 0) current.velocity = (touch.clientX - current.lastX) / elapsed;
      current.lastX = touch.clientX;
      current.lastAt = event.timeStamp;
      paint(clamp(current.from + dx, 0, width.current || 1), true);
    };
    const end = () => {
      const current = gesture.current;
      gesture.current = null;
      if (!current || current.axis !== 'x') return;
      const max = width.current || 1;
      const target =
        current.velocity < -FLICK
          ? false
          : current.velocity > FLICK
            ? true
            : offset.current > max * LOCK_AT;
      setOpen(target);
      const element = appRef.current;
      if (element) delete element.dataset.dragging;
      // One frame with transitions restored, then animate to the snap point.
      requestAnimationFrame(() => requestAnimationFrame(() => paint(target ? max : 0, false)));
      if (!target) {
        setClosing(true);
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setClosing(false), 380);
      }
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      gesture.current = null;
    };
  }, [disabled, measure, paint, painted]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
    };
  }, [hide, open]);

  useEffect(() => {
    const resize = () => {
      measure();
      if (openRef.current) paint(width.current, false);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [measure, paint]);

  useEffect(() => () => clearTimeout(settle.current), []);

  return { open, closing, show, hide, appRef, drawerRef };
}

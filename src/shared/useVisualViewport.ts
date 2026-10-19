import { useEffect } from 'react';

/**
 * Mirrors the visual viewport into CSS variables so fixed UI (the composer)
 * can stay above the on-screen keyboard.
 *
 * Android resizes the layout viewport together with the keyboard, so the
 * difference stays 0 there. iOS keeps the layout viewport intact and only
 * shrinks the visual viewport, which is exactly the offset we need.
 * --kb: keyboard height in px, always 0 while the keyboard is closed.
 */
export function useVisualViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = window.innerHeight - viewport.height - viewport.offsetTop;
        // Sub-80px differences come from browser chrome, not a keyboard.
        const keyboard = inset > 80 ? Math.round(inset) : 0;
        root.style.setProperty('--kb', `${keyboard}px`);
        if (keyboard) root.dataset.keyboard = 'open';
        else delete root.dataset.keyboard;
      });
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      root.style.removeProperty('--kb');
      delete root.dataset.keyboard;
    };
  }, []);
}

import { useEffect, useRef, type ReactNode } from 'react';

export function Carousel({
  index,
  labels,
  onSelect,
  children,
}: {
  index: number;
  labels: string[];
  onSelect: (index: number) => void;
  children: ReactNode[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const selected = useRef(index);
  selected.current = index;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const align = () => {
      const card = element.firstElementChild as HTMLElement | null;
      if (card)
        element.scrollTo({ left: selected.current * (card.offsetWidth + 12), behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = track.current;
    const card = element?.firstElementChild as HTMLElement | null;
    if (card && element)
      element.scrollTo({ left: index * (card.offsetWidth + 12), behavior: 'instant' });
    const button = navigation.current?.children[index] as HTMLElement | undefined;
    if (button && navigation.current) {
      const nav = navigation.current;
      nav.scrollTo({
        left: button.offsetLeft - nav.offsetLeft - (nav.clientWidth - button.clientWidth) / 2,
        behavior: 'instant',
      });
    }
  }, [index]);
  return (
    <>
      <div
        className="step-carousel"
        ref={track}
        role="region"
        aria-roledescription="轮播"
        aria-label="烹饪步骤卡片"
        tabIndex={0}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            onSelect(
              Math.max(0, Math.min(labels.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1))),
            );
          }
        }}
        onScroll={(e) => {
          const element = e.currentTarget;
          const card = element.firstElementChild as HTMLElement;
          const stride = card.offsetWidth + 12;
          const next = Math.round(element.scrollLeft / stride);
          if (
            Math.abs(element.scrollLeft - next * stride) < 2 &&
            next !== selected.current &&
            next >= 0 &&
            next < labels.length
          )
            onSelect(next);
        }}
      >
        {children.map((child, i) => (
          <article
            key={i}
            className={`step-card ${i === 0 ? 'preparation-card' : ''} ${i === index ? 'current-step' : ''}`}
            aria-label={i === 0 ? '准备：要点、食材和调味辅料、备菜' : `第 ${i} 步：${labels[i]}`}
            aria-hidden={i !== index}
            inert={i !== index}
          >
            <div className="step-card-scroll" tabIndex={i === index ? 0 : -1}>
              {child}
            </div>
          </article>
        ))}
      </div>
      <nav className="card-pagination" aria-label="跳转步骤" ref={navigation}>
        {labels.map((label, i) => (
          <button
            key={i}
            className={i === index ? 'active' : ''}
            aria-label={i ? `跳转第 ${i} 步` : '跳转准备卡片'}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => onSelect(i)}
          >
            {i > 0 && <span className="step-tab-number">{i}</span>}
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

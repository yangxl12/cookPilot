import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowRight, Check } from 'lucide-react';

export function Carousel({
  index,
  labels,
  onSelect,
  onFinish,
  finishLabel = '完成，返回首页',
  children,
}: {
  index: number;
  labels: string[];
  onSelect: (index: number) => void;
  onFinish?: () => void;
  finishLabel?: string;
  children: ReactNode[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const selected = useRef(index);
  const select = useRef(onSelect);
  const count = useRef(labels.length);
  const stride = useRef(0);
  selected.current = index;
  select.current = onSelect;
  count.current = labels.length;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const align = () => {
      const card = element.firstElementChild as HTMLElement | null;
      if (card) {
        stride.current = card.offsetWidth + 12;
        element.scrollTo({ left: selected.current * stride.current, behavior: 'instant' });
      }
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settled = () => {
      clearTimeout(timeout);
      if (!stride.current) return;
      const next = Math.max(
        0,
        Math.min(count.current - 1, Math.round(element.scrollLeft / stride.current)),
      );
      if (next !== selected.current) select.current(next);
    };
    const scroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(settled, 150);
    };
    element.addEventListener('scrollend', settled);
    const supportsScrollEnd = Reflect.has(element, 'onscrollend');
    if (!supportsScrollEnd) element.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
      element.removeEventListener('scrollend', settled);
      element.removeEventListener('scroll', scroll);
    };
  }, []);
  useEffect(() => {
    const element = track.current;
    if (element && stride.current && Math.abs(element.scrollLeft - index * stride.current) > 2)
      element.scrollTo({ left: index * stride.current, behavior: 'instant' });
    const button = navigation.current?.children[index] as HTMLElement | undefined;
    const nav = navigation.current;
    if (button && nav) {
      // offsetLeft 的参照物是 offsetParent，不一定是导航条本身，用矩形差算才不会偏。
      const rect = button.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      nav.scrollTo({
        left: nav.scrollLeft + rect.left - navRect.left - (nav.clientWidth - rect.width) / 2,
        behavior: 'instant',
      });
    }
  }, [index]);
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    // 滚到两端时文字会直接切在圆角上，淡出一点才不像是错位。
    const edges = () => {
      const max = element.scrollWidth - element.clientWidth;
      const next = [element.scrollLeft > 2 && 'l', element.scrollLeft < max - 2 && 'r']
        .filter(Boolean)
        .join(' ');
      if (element.dataset.edge !== next) element.dataset.edge = next;
    };
    edges();
    const observer = new ResizeObserver(edges);
    observer.observe(element);
    element.addEventListener('scroll', edges, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', edges);
    };
  }, [labels.length]);
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
              {i < labels.length - 1 ? (
                <button
                  className="primary wide card-next"
                  aria-label={`下一步：${labels[i + 1]}`}
                  onClick={() => onSelect(i + 1)}
                >
                  {i === 0 ? '开始烹饪' : '下一步'}
                  <ArrowRight size={17} />
                </button>
              ) : (
                onFinish && (
                  <button className="primary wide card-next" onClick={onFinish}>
                    <Check size={17} />
                    {finishLabel}
                  </button>
                )
              )}
            </div>
          </article>
        ))}
      </div>
      <nav className="card-pagination" aria-label="跳转步骤">
        <div className="card-pagination-track" ref={navigation}>
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
        </div>
      </nav>
    </>
  );
}

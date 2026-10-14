import { Component, type ReactNode } from 'react';

// A failed lazy download should leave a usable retry entry instead of a blank page.
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty-state">
        <p role="alert">页面暂时无法打开，请重试</p>
        <button className="primary" onClick={() => location.reload()}>
          重试
        </button>
      </div>
    );
  }
}

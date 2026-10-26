import React from 'react';
import { APP_LINKS } from '../lib/env';

/** Keeps one broken page from blanking the whole site: shows a friendly message and a retry. */
class ErrorBoundaryImpl extends (React as any).Component {
  state = { error: null as any };
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any) {
    console.error('[illtip-web]', error);
  }
  componentDidUpdate(prev: any) {
    if (prev.resetKey !== (this as any).props.resetKey && (this as any).state.error) (this as any).setState({ error: null });
  }
  render() {
    const self = this as any;
    if (!self.state.error) return self.props.children;
    return (
      <div className="empty">
        <div className="empty-title">Something went wrong on this page</div>
        <p className="muted">Please try again. If it keeps happening, use the i'llTip app.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => self.setState({ error: null })}>Try again</button>
          <a className="btn btn-ghost" href={APP_LINKS.android} target="_blank" rel="noreferrer">Android app</a>
          <a className="btn btn-ghost" href={APP_LINKS.ios} target="_blank" rel="noreferrer">iPhone app</a>
        </div>
      </div>
    );
  }
}
export const ErrorBoundary = ErrorBoundaryImpl as unknown as (props: { resetKey?: string; children?: any }) => any;

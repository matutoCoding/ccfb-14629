import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-loading error-screen">
          <div className="logo">!</div>
          <h2>页面渲染出现异常</h2>
          <p>{this.state.error.message}</p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>刷新页面</button>
            <button className="btn" onClick={() => this.setState({ error: null })}>尝试继续</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

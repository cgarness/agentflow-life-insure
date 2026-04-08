import React from 'react';

interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, State> {
  constructor(props: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#EF4444', background: '#0F172A', minHeight: '100vh' }}>
          <h2>Something went wrong loading this page.</h2>
          <pre style={{ color: '#94A3B8', fontSize: 12 }}>{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State { 
  hasError: boolean; 
  error?: Error 
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`ErrorBoundary caught an error in [${this.props.name || 'Unknown Component'}]:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 rounded-2xl bg-destructive/5 border border-destructive/20 text-destructive">
          <h3 className="text-sm font-bold mb-2">Something went wrong</h3>
          <p className="text-xs opacity-80 mb-3">
            There was an error loading {this.props.name || 'this section'}.
          </p>
          <pre className="text-[10px] bg-black/5 p-2 rounded overflow-auto max-h-32 font-mono">
            {this.state.error?.message}
          </pre>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 text-[10px] font-bold uppercase tracking-wider bg-destructive/10 hover:bg-destructive/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

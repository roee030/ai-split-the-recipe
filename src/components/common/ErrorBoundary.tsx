import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary — catches unhandled React render errors
 * and displays a user-friendly recovery screen instead of a blank crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Surface to Sentry / PostHog if available
    if (import.meta.env.PROD) {
      console.error('[ErrorBoundary] Unhandled error:', error, info.componentStack);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl mb-5">😵</div>
          <h1 className="font-display text-xl font-bold text-primary mb-2">
            Something went wrong
          </h1>
          <p className="text-muted text-sm mb-6 max-w-xs">
            An unexpected error occurred. Your data is safe — please reload the app.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mb-6 text-start text-xs text-red-600 bg-red-50 rounded-xl p-4 max-w-sm overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            className="px-6 py-3 rounded-2xl bg-accent text-white font-bold text-sm shadow-lg shadow-accent/30"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

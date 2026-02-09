import { Component, type ReactNode, type ErrorInfo } from "react";

import { Sentry } from "../utils/sentry";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // Report error to Sentry with React context
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
      tags: {
        errorBoundary: true,
      },
    });
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          resetError={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

 
const DefaultErrorFallback: React.FC<DefaultErrorFallbackProps> = ({
  error,
  resetError,
}) => {
  return (
    <div className="bg-page flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-xl border border-neutral-200 bg-white p-8 shadow-large">
        <h1 className="mb-4 text-4xl font-semibold text-neutral-900">Error</h1>
        <p className="mb-4 text-xl font-semibold text-red-600">
          {error.message || "Something went wrong"}
        </p>
        <div className="flex gap-3">
          <button
            onClick={resetError}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored"
          >
            Try Again
          </button>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  );
};

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

// eslint-disable-next-line react-refresh/only-export-components
const DefaultErrorFallback: React.FC<DefaultErrorFallbackProps> = ({
  error,
  resetError,
}) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-50 p-8">
      <div className="max-w-2xl w-full border border-neutral-200 rounded-xl shadow-large p-8 bg-white">
        <h1 className="text-4xl font-semibold text-neutral-900 mb-4">Error</h1>
        <p className="text-xl mb-4 text-red-600 font-semibold">
          {error.message || "Something went wrong"}
        </p>
        <div className="flex gap-3">
          <button
            onClick={resetError}
            className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="border border-neutral-300 bg-white px-4 py-2 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  );
};

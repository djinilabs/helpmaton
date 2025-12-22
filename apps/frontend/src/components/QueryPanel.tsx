import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";

import { ErrorBoundary } from "./ErrorBoundary";

interface QueryPanelProps {
  children: ReactNode;
  fallback: ReactNode;
  errorFallback?: (error: Error, resetError: () => void) => ReactNode;
  className?: string;
}

const DefaultErrorFallback: React.FC<{
  error: Error;
  resetError: () => void;
  resetQueryError: () => void;
}> = ({ error, resetError, resetQueryError }) => {
  const handleRetry = () => {
    resetQueryError();
    resetError();
  };

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="mb-2 text-sm font-semibold text-red-800">Error</div>
      <div className="mb-3 text-xs text-red-700">
        {error.message || "Something went wrong"}
      </div>
      <button
        onClick={handleRetry}
        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
      >
        Try Again
      </button>
    </div>
  );
};

export const QueryPanel: React.FC<QueryPanelProps> = ({
  children,
  fallback,
  errorFallback,
  className,
}) => {
  const { reset } = useQueryErrorResetBoundary();

  const defaultErrorFallback = (error: Error, resetError: () => void) => (
    <DefaultErrorFallback
      error={error}
      resetError={resetError}
      resetQueryError={reset}
    />
  );

  return (
    <div className={className}>
      <ErrorBoundary fallback={errorFallback || defaultErrorFallback}>
        <Suspense fallback={fallback}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  );
};

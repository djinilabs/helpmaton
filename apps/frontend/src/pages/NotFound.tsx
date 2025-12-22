import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";

const NotFound: FC = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-medium">
        <h1 className="mb-6 text-8xl font-black tracking-tight text-neutral-900">
          404
        </h1>
        <h2 className="mb-4 text-3xl font-semibold tracking-wide text-neutral-900">
          Page Not Found
        </h2>
        <p className="mb-8 text-lg font-semibold text-neutral-600">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        {location.pathname && location.pathname !== "/" && (
          <p className="mb-8 rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-500">
            Attempted path:{" "}
            <span className="font-semibold">{location.pathname}</span>
          </p>
        )}
        <Link
          to="/"
          className="inline-block transform rounded-xl bg-gradient-primary px-8 py-4 font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-colored active:scale-[0.98]"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;

import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";

const NotFound: FC = () => {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center border border-neutral-200 rounded-2xl shadow-medium p-12 bg-white">
        <h1 className="text-8xl font-black text-neutral-900 mb-6 tracking-tight">
          404
        </h1>
        <h2 className="text-3xl font-semibold text-neutral-900 mb-4 tracking-wide">
          Page Not Found
        </h2>
        <p className="text-lg text-neutral-600 mb-8 font-semibold">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        {location.pathname && location.pathname !== "/" && (
          <p className="text-sm text-neutral-500 mb-8 font-mono bg-neutral-50 p-3 border border-neutral-200 rounded-lg">
            Attempted path:{" "}
            <span className="font-semibold">{location.pathname}</span>
          </p>
        )}
        <Link
          to="/"
          className="inline-block px-8 py-4 text-white font-semibold rounded-xl hover:shadow-colored bg-gradient-primary transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;

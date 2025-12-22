import { useSession } from "next-auth/react";
import { type FC, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

import { useTokenGeneration } from "../hooks/useTokenGeneration";

import { Footer } from "./Footer";
import { Header } from "./Header";
import { LoadingScreen } from "./LoadingScreen";
import { LocationBar } from "./LocationBar";
import Login from "./Login";

export const RequiresSession: FC<PropsWithChildren> = ({ children }) => {
  const { status } = useSession({ required: false });
  const location = useLocation();

  // Generate Bearer tokens after successful Auth.js login
  useTokenGeneration();

  // Allow invite acceptance route without authentication
  const isInviteRoute = location.pathname.match(
    /^\/workspaces\/[^/]+\/invites\/[^/]+$/
  );

  // Allow API docs route without authentication (but still show layout)
  const isApiDocsRoute = location.pathname.startsWith("/docs/api");

  if (status === "loading") {
    return <LoadingScreen />;
  }

  // If it's an invite route, allow it through without requiring authentication
  if (isInviteRoute) {
    return (
      <div className="flex min-h-screen flex-col">
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  // If it's an API docs route, allow it through without requiring authentication
  // but still show the layout (Header, LocationBar, Footer)
  if (isApiDocsRoute) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <LocationBar />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Login />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <Header />
      <LocationBar />
      <main className="flex-1 bg-neutral-50 dark:bg-neutral-950">
        {children}
      </main>
      <Footer />
    </div>
  );
};

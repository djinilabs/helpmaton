import { ApiReferenceReact } from "@scalar/api-reference-react";
import { useEffect, useRef } from "react";
import "@scalar/api-reference-react/style.css";
// import { useSession } from "next-auth/react";

import { useTheme } from "../hooks/useTheme";
import { apiFetch } from "../utils/api";

const ApiDocs = () => {
  // Session status is available if needed for future enhancements
  // useSession({ required: false });

  const { theme, preference } = useTheme();
  const prevPreferenceRef = useRef<string | null>(null);
  const isInitialMount = useRef<boolean>(true);

  console.log("theme", theme);
  console.log("preference", preference);

  // Force page reload when theme preference changes (only after initial mount)
  useEffect(() => {
    console.log("preference", preference);
    console.log("prevPreferenceRef", prevPreferenceRef.current);

    // Skip on initial mount to avoid reloading on first render
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevPreferenceRef.current = preference;
      return;
    }

    // Reload page when preference changes
    if (
      prevPreferenceRef.current !== null &&
      prevPreferenceRef.current !== preference
    ) {
      window.location.reload();
    }
  }, [preference]);

  return (
    <div className="size-full bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl p-6 text-neutral-700 dark:text-neutral-200">
        <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
          API reference
        </h1>
        <p className="mt-2 text-sm">
          This section is for developers building integrations. If you&apos;re
          just getting started, you can manage everything from the UI.
        </p>
      </div>
      <style>
        {`
          /* Override Scalar background colors to match app theme */
          :root,
          .light-mode,
          html:not(.dark),
          html:not(.dark-mode) {
            --scalar-background-1: #fafaf9;
            --scalar-background-2: #f5f5f4;
            --scalar-background-3: #e7e5e4;
          }
          .dark,
          .dark-mode,
          html.dark,
          html.dark-mode {
            --scalar-background-1: rgba(28, 25, 23, 0.9);
            --scalar-background-2: #1c1917;
            --scalar-background-3: #292524;
          }
          /* Ensure Scalar's root container uses our background */
          .scalar-api-reference {
            background-color: #fafaf9 !important;
          }
          html.dark .scalar-api-reference,
          html.dark-mode .scalar-api-reference {
            background-color: rgba(28, 25, 23, 0.9) !important;
          }
          /* Target Scalar's main wrapper element */
          .scalar-api-reference > div:first-child {
            background-color: inherit !important;
          }
        `}
      </style>
      <ApiReferenceReact
        configuration={{
          url: "/openapi.json",
          darkMode: true,
          forceDarkModeState: theme === "dark" ? "dark" : "light",
          hideDarkModeToggle: true,
          theme: "purple",
          withDefaultFonts: true,
          telemetry: false,
          fetch: (input, init) => {
            // Convert RequestInfo to string URL for apiFetch
            let url: string;
            if (typeof input === "string") {
              url = input;
            } else if (input instanceof Request) {
              url = input.url;
            } else {
              url = input.toString();
            }
            return apiFetch(url, init || {});
          },
        }}
      />
    </div>
  );
};

export default ApiDocs;

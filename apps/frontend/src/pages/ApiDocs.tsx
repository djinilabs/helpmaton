import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
// import { useSession } from "next-auth/react";

import { apiFetch } from "../utils/api";

const ApiDocs = () => {
  // Session status is available if needed for future enhancements
  // useSession({ required: false });

  return (
    <div className="size-full">
      <ApiReferenceReact
        configuration={{
          url: "/openapi.json",
          darkMode: false,
          forceDarkModeState: "light",
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

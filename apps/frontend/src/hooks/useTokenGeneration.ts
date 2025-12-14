import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

import { clearTokens, setTokens } from "../utils/api";

/**
 * Hook to generate Bearer tokens after successful Auth.js login
 * This is a one-time migration step - once tokens are generated, they're stored in localStorage
 */
export function useTokenGeneration() {
  const { data: session, status } = useSession();
  const tokensGeneratedRef = useRef(false);
  const tokenGenerationPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    // Only generate tokens once per session
    if (
      status === "authenticated" &&
      session?.user &&
      !tokensGeneratedRef.current
    ) {
      // Check if we already have tokens
      const existingAccessToken = localStorage.getItem(
        "helpmaton_access_token"
      );
      if (existingAccessToken) {
        // Tokens already exist, don't regenerate
        tokensGeneratedRef.current = true;
        return;
      }

      // Prevent race condition: if a token generation is already in progress, wait for it
      if (tokenGenerationPromiseRef.current) {
        tokenGenerationPromiseRef.current.then(() => {
          tokensGeneratedRef.current = true;
        });
        return;
      }

      // Mark as generating and create the promise
      tokenGenerationPromiseRef.current = (async () => {
        try {
          // Generate tokens by calling the endpoint
          // This requires a valid cookie-based session (temporary migration step)
          const response = await fetch("/api/user/generate-tokens", {
            method: "POST",
            credentials: "include", // Include cookies for this one-time call
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data.accessToken && data.refreshToken) {
              setTokens(data.accessToken, data.refreshToken);
              console.log("[useTokenGeneration] Tokens generated and stored");
              tokensGeneratedRef.current = true;
            } else {
              console.error(
                "[useTokenGeneration] Invalid response: missing tokens"
              );
              // Show user-facing error
              if (typeof window !== "undefined") {
                alert(
                  "Failed to initialize session. Please refresh the page and try again."
                );
              }
            }
          } else {
            const errorText = await response.text();
            console.error(
              "[useTokenGeneration] Failed to generate tokens:",
              response.status,
              response.statusText,
              errorText
            );
            // Show user-facing error
            if (typeof window !== "undefined") {
              alert(
                "Failed to initialize session. Please refresh the page and try again."
              );
            }
          }
        } catch (error) {
          console.error("[useTokenGeneration] Error generating tokens:", error);
          // Show user-facing error
          if (typeof window !== "undefined") {
            alert(
              "Failed to initialize session. Please check your connection and refresh the page."
            );
          }
        } finally {
          tokenGenerationPromiseRef.current = null;
        }
      })();

      // Wait for the promise to complete
      tokenGenerationPromiseRef.current.then(() => {
        tokensGeneratedRef.current = true;
      });
    } else if (status === "unauthenticated") {
      // Reset the flag when user logs out
      tokensGeneratedRef.current = false;
      clearTokens();
    }
  }, [status, session]);
}

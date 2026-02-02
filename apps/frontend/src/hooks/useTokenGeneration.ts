import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

import { clearTokens, getAccessToken, setTokens } from "../utils/api";

/**
 * Hook to generate Bearer tokens after successful Auth.js login
 * This is a one-time migration step - once tokens are generated, they're stored in localStorage
 * @returns {boolean} Whether tokens are ready (either already existed or were just generated)
 */
export function useTokenGeneration(): boolean {
  const { data: session, status } = useSession();
  const tokensGeneratedRef = useRef(false);
  const tokenGenerationPromiseRef = useRef<Promise<void> | null>(null);
  const [tokensReady, setTokensReady] = useState(false);

  useEffect(() => {
    // Only generate tokens once per session
    if (
      status === "authenticated" &&
      session?.user &&
      !tokensGeneratedRef.current
    ) {
      // Check if we already have tokens
      const existingAccessToken = getAccessToken();
      if (existingAccessToken) {
        // Tokens already exist, don't regenerate
        tokensGeneratedRef.current = true;
        setTokensReady(true);
        return;
      }

      // Prevent race condition: if a token generation is already in progress, wait for it
      if (tokenGenerationPromiseRef.current) {
        tokenGenerationPromiseRef.current.then(() => {
          // After waiting, check if tokens actually exist (the promise may have failed)
          const accessToken = getAccessToken();
          if (accessToken) {
            tokensGeneratedRef.current = true;
            setTokensReady(true);
          } else {
            // Token generation failed, tokens are not ready
            setTokensReady(false);
          }
        });
        return;
      }

      // Mark as generating and create the promise
      tokenGenerationPromiseRef.current = (async () => {
        const showSessionError = (message: string) => {
          if (typeof window !== "undefined") {
            alert(message);
          }
          tokensGeneratedRef.current = false;
          setTokensReady(false);
        };

        const attemptGenerateTokens = async (): Promise<boolean> => {
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
              setTokensReady(true);
              return true;
            }
            console.error(
              "[useTokenGeneration] Invalid response: missing tokens"
            );
            return false;
          }

          const errorText = await response.text();
          console.error(
            "[useTokenGeneration] Failed to generate tokens:",
            response.status,
            response.statusText,
            errorText
          );
          return false;
        };

        try {
          let success = await attemptGenerateTokens();
          // Retry once after a short delay (handles session cookie / timing after login or reload)
          if (!success) {
            await new Promise((r) => setTimeout(r, 500));
            success = await attemptGenerateTokens();
          }
          if (!success) {
            showSessionError(
              "Failed to initialize session. Please refresh the page and try again."
            );
          }
        } catch (error) {
          const isAbort =
            error instanceof Error && error.name === "AbortError";
          if (isAbort) {
            // Request was aborted (e.g. React Strict Mode unmount); don't alert – next mount may retry
            console.warn(
              "[useTokenGeneration] Generate-tokens request was aborted"
            );
            tokensGeneratedRef.current = false;
            setTokensReady(false);
          } else {
            console.error(
              "[useTokenGeneration] Error generating tokens:",
              error
            );
            // Retry once on network/other errors (e.g. session not ready right after login)
            let recovered = false;
            try {
              await new Promise((r) => setTimeout(r, 500));
              recovered = await attemptGenerateTokens();
              if (!recovered) {
                showSessionError(
                  "Failed to initialize session. Please check your connection and refresh the page."
                );
              }
            } catch (retryError) {
              const retryAbort =
                retryError instanceof Error &&
                retryError.name === "AbortError";
              if (!retryAbort) {
                console.error(
                  "[useTokenGeneration] Retry failed:",
                  retryError
                );
                showSessionError(
                  "Failed to initialize session. Please check your connection and refresh the page."
                );
              }
            }
            if (!recovered) {
              tokensGeneratedRef.current = false;
              setTokensReady(false);
            }
          }
        } finally {
          tokenGenerationPromiseRef.current = null;
        }
      })();
    } else if (
      status === "authenticated" &&
      session?.user &&
      tokensGeneratedRef.current
    ) {
      // Session is authenticated and we've already generated tokens
      // Verify tokens still exist (they might have been cleared)
      const existingAccessToken = getAccessToken();
      if (existingAccessToken) {
        setTokensReady(true);
      } else {
        // Tokens were cleared, reset state
        tokensGeneratedRef.current = false;
        setTokensReady(false);
      }
    } else if (status === "unauthenticated") {
      // Reset the flag when user logs out
      tokensGeneratedRef.current = false;
      setTokensReady(false);
      clearTokens();
    } else if (status === "loading") {
      // While loading, check if tokens already exist
      // If they do, keep tokensReady as true to avoid infinite loading
      const existingAccessToken = getAccessToken();
      if (existingAccessToken && tokensGeneratedRef.current) {
        // Tokens exist and were previously generated, keep ready state
        setTokensReady(true);
      } else {
        // No tokens or not yet generated, tokens are not ready
        setTokensReady(false);
      }
    }
  }, [status, session]);

  return tokensReady;
}

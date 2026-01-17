import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../utils/api";
import { checkForServiceWorkerUpdate } from "../utils/serviceWorker";

const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION || "0.0.0";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// Note: prerelease/build metadata is treated as numeric segments only.
const parseSemver = (version: string): number[] => {
  return version.split(".").map((part) => {
    const numeric = part.replace(/[^0-9]/g, "");
    return numeric ? Number(numeric) : 0;
  });
};

const compareSemver = (a: string, b: string): number => {
  const aParts = parseSemver(a);
  const bParts = parseSemver(b);
  const length = Math.max(aParts.length, bParts.length, 3);

  for (let i = 0; i < length; i += 1) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
};

export function useAppVersion(intervalMs = DEFAULT_INTERVAL_MS) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const checkVersion = useCallback(async () => {
    try {
      await checkForServiceWorkerUpdate();
      const response = await apiFetch("/api/version");
      const data = (await response.json()) as { version?: string };
      if (!data?.version) {
        return;
      }

      if (compareSemver(data.version, CURRENT_VERSION) > 0) {
        setLatestVersion(data.version);
      } else {
        setLatestVersion(null);
        setDismissedVersion(null);
      }
    } catch (error) {
      console.warn("[version-check] Failed to fetch version:", error);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(checkVersion, 0);
    const intervalId = window.setInterval(checkVersion, intervalMs);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [checkVersion, intervalMs]);

  const isUpdateAvailable =
    latestVersion !== null &&
    compareSemver(latestVersion, CURRENT_VERSION) > 0 &&
    latestVersion !== dismissedVersion;

  const dismissUpdate = () => {
    if (latestVersion) {
      setDismissedVersion(latestVersion);
    }
  };

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    isUpdateAvailable,
    dismissUpdate,
  };
}

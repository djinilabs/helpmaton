import { useEffect, useMemo } from "react";

import { useLocalPreference } from "./useLocalPreference";

export type Theme = "light" | "dark" | "system";

/**
 * Get the device's color scheme preference
 */
function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Resolve the actual theme to apply based on preference
 */
function resolveTheme(preference: Theme): "light" | "dark" {
  if (preference === "system") {
    return getSystemTheme();
  }
  return preference;
}

/**
 * Apply theme class to HTML element
 */
function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") {
    return;
  }
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
}

/**
 * Hook to manage theme preference with localStorage persistence
 * and device preference detection
 */
export function useTheme() {
  const [preference, setPreference] = useLocalPreference<Theme>("theme", "system");

  // Resolve the actual theme to apply
  const resolvedTheme = useMemo(() => resolveTheme(preference), [preference]);

  // Apply theme to HTML element
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Listen to device preference changes when using system theme
  useEffect(() => {
    if (preference !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const newTheme = resolveTheme("system");
      applyTheme(newTheme);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Fallback for older browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [preference]);

  return {
    theme: resolvedTheme,
    preference,
    setPreference,
  };
}


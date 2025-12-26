import { useCallback, useEffect, useRef, useState } from "react";

export const useLocalPreference = <T>(name: string, defaultValue: T) => {
  const getItem = useCallback(() => {
    const storedValue = localStorage.getItem(name);
    if (storedValue && storedValue !== "undefined") {
      return JSON.parse(storedValue);
    }
    return defaultValue;
  }, [defaultValue, name]);

  const [value, setValue] = useState<T>(() => getItem());
  const isUpdatingRef = useRef(false);

  // Listen to storage changes (works for cross-tab changes)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === name && e.newValue !== null && !isUpdatingRef.current) {
        try {
          const newValue = JSON.parse(e.newValue);
          setValue(newValue);
        } catch {
          // Invalid JSON, ignore
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [name]);

  // Also check for changes in the same window by listening to custom events
  // This is needed because storage events don't fire in the same window
  useEffect(() => {
    const handleCustomStorageChange = (e: CustomEvent) => {
      if (e.detail?.key === name && !isUpdatingRef.current) {
        const newValue = getItem();
        setValue(newValue);
      }
    };

    window.addEventListener(
      "localStorageChange",
      handleCustomStorageChange as EventListener
    );
    return () =>
      window.removeEventListener(
        "localStorageChange",
        handleCustomStorageChange as EventListener
      );
  }, [name, getItem]);

  // Custom setValue that dispatches a custom event for same-window updates
  const setValueWithEvent = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      isUpdatingRef.current = true;
      const valueToStore =
        typeof newValue === "function" ? (newValue as (prev: T) => T)(value) : newValue;
      localStorage.setItem(name, JSON.stringify(valueToStore));
      setValue(valueToStore);
      // Dispatch custom event for same-window listeners
      window.dispatchEvent(
        new CustomEvent("localStorageChange", {
          detail: { key: name, value: valueToStore },
        })
      );
      // Reset flag after a brief delay to allow event handlers to process
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    },
    [name, value]
  );

  return [value, setValueWithEvent] as const;
};

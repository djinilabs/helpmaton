import { useCallback, useEffect, useState } from "react";

export const useLocalPreference = <T>(name: string, defaultValue: T) => {
  const getItem = useCallback(() => {
    const storedValue = localStorage.getItem(name);
    if (storedValue && storedValue !== "undefined") {
      return JSON.parse(storedValue);
    }
    return defaultValue;
  }, [defaultValue, name]);

  const [value, setValue] = useState<T>(() => getItem());

  useEffect(() => {
    setValue(getItem());
  }, [getItem]);

  useEffect(() => {
    localStorage.setItem(name, JSON.stringify(value));
  }, [name, value]);

  return [value, setValue] as const;
};

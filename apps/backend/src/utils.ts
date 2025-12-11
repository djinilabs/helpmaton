export const getDefined = <T>(
  value: T | null | undefined,
  errorMessage = "Value is null or undefined"
): NonNullable<T> => {
  if (value === null || value === undefined) {
    throw new Error(errorMessage);
  }
  return value;
};

export const once = <T>(fn: () => T): (() => T) => {
  let called = false;
  let result: T | null = null;
  return () => {
    if (!called) {
      called = true;
      result = fn();
    }
    return result as T;
  };
};


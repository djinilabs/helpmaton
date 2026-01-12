import { useState, useEffect, useRef, useCallback, type FC } from "react";

interface SliderProps {
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  onChange: (value: number | undefined) => void;
  label?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  className?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

export const Slider: FC<SliderProps> = ({
  value,
  min,
  max,
  step,
  onChange,
  label,
  showValue = true,
  formatValue,
  className = "",
  disabled = false,
  id,
  placeholder,
}) => {
  // Helper function to format the display value
  const getDisplayValue = useCallback((val: number | undefined): string => {
    if (val === undefined) {
      return placeholder || "";
    }
    return formatValue
      ? formatValue(val)
      : step < 1
        ? val.toFixed(step.toString().split(".")[1]?.length || 2)
        : val.toString();
  }, [formatValue, step, placeholder]);

  // Initialize text value from the value prop
  const [textValue, setTextValue] = useState<string>(() => {
    if (value === undefined) {
      return placeholder || "";
    }
    return formatValue
      ? formatValue(value)
      : step < 1
        ? value.toFixed(step.toString().split(".")[1]?.length || 2)
        : value.toString();
  });
  const [error, setError] = useState<string | null>(null);
  const prevValueRef = useRef<number | undefined>(value);
  const isFocusedRef = useRef<boolean>(false);

  // Sync text input when value prop changes (only when not focused)
  useEffect(() => {
    // Don't update text input if user is currently typing
    if (isFocusedRef.current) {
      return;
    }

    // Only update if value actually changed
    if (prevValueRef.current === value) {
      return;
    }
    prevValueRef.current = value;

    // Sync text input with value prop - this is necessary for proper two-way binding
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTextValue(getDisplayValue(value));
    setError(null);
  }, [value, getDisplayValue]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    const numValue = parseFloat(inputValue);
    if (!isNaN(numValue)) {
      // Clamp value between min and max
      const clampedValue = Math.max(min, Math.min(max, numValue));
      onChange(clampedValue);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Keep the raw input while user is typing - don't format it
    setTextValue(inputValue);

    // If empty and placeholder exists, allow it (for optional values)
    if (inputValue.trim() === "" && placeholder) {
      setError(null);
      onChange(undefined);
      return;
    }

    // If empty without placeholder, show error but keep the input
    if (inputValue.trim() === "") {
      setError("Value is required");
      return;
    }

    // Strip currency symbols and formatting characters ($, €, £, commas, spaces, etc.)
    // Allow negative sign, decimal point, and digits
    const cleanedValue = inputValue
      .replace(/[$€£¥,\s]/g, "") // Remove currency symbols, commas, spaces
      .trim();

    // Check if it's a valid number pattern (allow partial input like "3." or "-")
    if (!/^-?\d*\.?\d*$/.test(cleanedValue)) {
      setError("Please enter a valid number");
      return;
    }

    // If it's just a sign or decimal point, allow it (partial input)
    if (cleanedValue === "" || cleanedValue === "-" || cleanedValue === "." || cleanedValue === "-.") {
      setError(null);
      // Don't update the value yet if it's partial input
      return;
    }

    // Parse the cleaned value
    const numValue = parseFloat(cleanedValue);
    
    // Check if it's a valid number
    if (isNaN(numValue)) {
      setError("Please enter a valid number");
      return;
    }

    // Check if it's within bounds
    if (numValue < min) {
      setError(`Value must be at least ${min}`);
      // Still update the value so slider moves, but show error
    } else if (numValue > max) {
      setError(`Value must be at most ${max}`);
      // Still update the value so slider moves, but show error
    } else {
      setError(null);
    }

    // Round to nearest step
    const roundedValue = Math.round(numValue / step) * step;
    
    // Check if rounded value is within bounds (handle floating point precision)
    const clampedValue = Math.max(min, Math.min(max, roundedValue));

    // Update the actual value (this will move the slider)
    // But keep the raw text input so user can continue typing
    onChange(clampedValue);
  };

  const handleTextFocus = () => {
    isFocusedRef.current = true;
  };

  const handleTextBlur = () => {
    isFocusedRef.current = false;
    
    // On blur, format the text to the final value
    setTextValue(getDisplayValue(value));
    if (error) {
      setError(null);
    }
  };

  // For range inputs, we need a numeric value, so use min if value is undefined
  const rangeValue = value ?? min;
  const textInputId = id ? `${id}-text` : undefined;

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={textInputId || id}
          className="mb-2 block text-sm font-semibold dark:text-neutral-300"
        >
          {label}
        </label>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            id={textInputId}
            type="text"
            value={textValue}
            onChange={handleTextChange}
            onFocus={handleTextFocus}
            onBlur={handleTextBlur}
            disabled={disabled}
            className={`w-24 rounded-xl border-2 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 focus:outline-none focus:ring-4 dark:bg-neutral-900 dark:text-neutral-50 ${
              error
                ? "border-error-500 focus:border-error-500 focus:ring-error-500 dark:border-error-500"
                : "border-neutral-300 focus:border-primary-500 focus:ring-primary-500 dark:border-neutral-700 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            aria-label={label ? `${label} (text input)` : "Value"}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error && id ? `${id}-error` : undefined}
          />
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={rangeValue}
            onChange={handleSliderChange}
            disabled={disabled}
            className="flex-1 accent-primary-500"
            aria-label={label ? `${label} (slider)` : "Value"}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
          />
          {showValue && (
            <span className="w-16 text-right text-sm text-neutral-600 dark:text-neutral-300">
              {value !== undefined
                ? formatValue
                  ? formatValue(value)
                  : step < 1
                    ? value.toFixed(2)
                    : value.toString()
                : placeholder || ""}
            </span>
          )}
        </div>
        {error && (
          <span
            id={id ? `${id}-error` : undefined}
            className="text-xs font-semibold text-error-600 dark:text-error-400"
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
};

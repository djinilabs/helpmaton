import type { FC } from "react";

import { useTheme } from "../hooks/useTheme";

export const ThemeToggle: FC = () => {
  const { theme, preference, setPreference } = useTheme();

  const toggleTheme = () => {
    // Toggle directly between light and dark
    if (preference === "light") {
      setPreference("dark");
    } else if (preference === "dark") {
      setPreference("light");
    } else {
      // If preference is "system", toggle based on current resolved theme
      setPreference(theme === "dark" ? "light" : "dark");
    }
  };

  // Determine icon based on resolved theme (not preference)
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-xl border-2 border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 hover:border-neutral-400 transition-all duration-200 transform hover:scale-[1.05] active:scale-[0.95] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:border-neutral-600"
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Current: ${preference === "system" ? "system" : theme} (Click to toggle)`}
    >
      {isDark ? (
        // Sun icon for light mode
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        // Moon icon for dark mode
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      )}
    </button>
  );
};


import { useState, useEffect } from "react";
import type { FC } from "react";

import { LockSpinner } from "./LockSpinner";

const FUNNY_MESSAGES = [
  "Calibrating neural pathways...",
  "Teaching robots to dance...",
  "Counting to infinity (we're at 47)...",
  "Bribing the hamsters in the server...",
  "Convincing electrons to behave...",
  "Asking the AI nicely to hurry up...",
  "Defragmenting reality...",
  "Polishing the quantum bits...",
  "Herding digital cats...",
  "Convincing the code it's not a bug, it's a feature...",
  "Baking fresh cookies for the API...",
  "Teaching the database to count...",
  "Negotiating with the cloud...",
  "Untangling the yarn of fate...",
  "Asking the pixels to align properly...",
  "Convincing the router it's not a toaster...",
  "Teaching the server to juggle...",
  "Calibrating the flux capacitor...",
  "Polishing the chrome on the browser...",
  "Asking the network to stop being dramatic...",
];

interface LoadingScreenProps {
  message?: string;
  className?: string;
  compact?: boolean;
}

export const LoadingScreen: FC<LoadingScreenProps> = ({
  message,
  className = "",
  compact = false,
}) => {
  const [showComplexAnimation, setShowComplexAnimation] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    // Show simple loading for first 3 seconds, then switch to complex animation
    const timeout = setTimeout(() => {
      setShowComplexAnimation(true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // Only rotate messages if complex animation is shown and no specific message is provided
    if (!showComplexAnimation || message) {
      return;
    }

    // Randomly select a message every 2 seconds
    const interval = setInterval(() => {
      setMessageIndex(() => Math.floor(Math.random() * FUNNY_MESSAGES.length));
    }, 2000);

    return () => clearInterval(interval);
  }, [showComplexAnimation, message]);

  const currentMessage = message || FUNNY_MESSAGES[messageIndex];

  // Simple loading state (first 3 seconds)
  if (!showComplexAnimation) {
    if (compact) {
      return (
        <div
          className={`flex items-center justify-center gap-3 py-8 ${className}`}
        >
          <LockSpinner size="small" />
          <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {message || "Loading..."}
          </div>
        </div>
      );
    }

    return (
      <div
        className={`flex min-h-screen items-center justify-center bg-page ${className}`}
      >
        <div className="flex items-center gap-3">
          <LockSpinner size="small" />
          <div className="text-xl font-medium text-neutral-600 dark:text-neutral-300">
            {message || "Loading..."}
          </div>
        </div>
      </div>
    );
  }

  // Complex animation (after 3 seconds)
  if (compact) {
    return (
      <div
        className={`flex items-center justify-center gap-3 py-8 ${className}`}
      >
        <LockSpinner size="medium" />
        <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {currentMessage}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center bg-page ${className}`}
    >
      <div className="relative mb-8">
        <LockSpinner size="large" />
      </div>

      {/* Status message */}
      <div className="px-6 text-center">
        <div className="mb-2 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {currentMessage}
        </div>
        {/* Animated dots */}
        <div className="mt-4 flex items-center justify-center gap-1.5">
          <div
            className="size-2 rounded-full bg-primary-400"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0s",
            }}
          />
          <div
            className="size-2 rounded-full bg-primary-400"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0.2s",
            }}
          />
          <div
            className="size-2 rounded-full bg-primary-400"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0.4s",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  );
};

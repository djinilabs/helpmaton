import { useState, useEffect } from "react";
import type { FC } from "react";

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

    // Rotate through messages every 2 seconds
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % FUNNY_MESSAGES.length);
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
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
            {message || "Loading..."}
          </div>
        </div>
      );
    }

    return (
      <div
        className={`flex items-center justify-center min-h-screen bg-gradient-soft dark:bg-neutral-950 ${className}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-xl font-medium text-neutral-600 dark:text-neutral-400">
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
        <div className="relative w-12 h-12">
          <div
            className="absolute inset-0 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"
            style={{ animationDuration: "1s" }}
          ></div>
          <div className="absolute inset-2 flex items-center justify-center">
            <img
              src="/images/helpmaton_logo.svg"
              alt="Helpmaton Logo"
              className="w-full h-full opacity-80"
            />
          </div>
        </div>
        <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {currentMessage}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center min-h-screen bg-gradient-soft dark:bg-neutral-950 ${className}`}
    >
      <div className="relative mb-8">
        {/* Animated logo container */}
        <div className="relative w-32 h-32">
          {/* Rotating outer ring with gradient */}
          <div
            className="absolute inset-0 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"
            style={{ animationDuration: "2s" }}
          ></div>

          {/* Subtle glow effect */}
          <div className="absolute inset-0 bg-gradient-primary/10 rounded-full blur-xl"></div>

          {/* Logo */}
          <div className="absolute inset-4 flex items-center justify-center">
            <div className="relative">
              <img
                src="/images/helpmaton_logo.svg"
                alt="Helpmaton Logo"
                className="w-full h-full opacity-90 drop-shadow-sm"
              />
            </div>
          </div>

          {/* Subtle pulsing dots around the logo */}
          <div className="absolute inset-0">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="absolute w-2 h-2 bg-primary-400 rounded-full"
                style={{
                  top: "50%",
                  left: "50%",
                  transform: `translate(-50%, -50%) rotate(${
                    i * 90
                  }deg) translateY(-60px)`,
                  animation: `pulse-dot-${i} 2s ease-in-out infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Status message */}
      <div className="text-center px-6">
        <div className="text-2xl font-semibold text-neutral-900 mb-2 tracking-tight dark:text-neutral-50">
          {currentMessage}
        </div>
        {/* Animated dots */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          <div
            className="w-2 h-2 bg-primary-400 rounded-full"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0s",
            }}
          />
          <div
            className="w-2 h-2 bg-primary-400 rounded-full"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0.2s",
            }}
          />
          <div
            className="w-2 h-2 bg-primary-400 rounded-full"
            style={{
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: "0.4s",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot-0 {
          0%, 100% {
            opacity: 0.3;
            transform: translate(-50%, -50%) rotate(0deg) translateY(-60px) scale(1);
          }
          50% {
            opacity: 0.7;
            transform: translate(-50%, -50%) rotate(0deg) translateY(-65px) scale(1.3);
          }
        }
        @keyframes pulse-dot-1 {
          0%, 100% {
            opacity: 0.3;
            transform: translate(-50%, -50%) rotate(90deg) translateY(-60px) scale(1);
          }
          50% {
            opacity: 0.7;
            transform: translate(-50%, -50%) rotate(90deg) translateY(-65px) scale(1.3);
          }
        }
        @keyframes pulse-dot-2 {
          0%, 100% {
            opacity: 0.3;
            transform: translate(-50%, -50%) rotate(180deg) translateY(-60px) scale(1);
          }
          50% {
            opacity: 0.7;
            transform: translate(-50%, -50%) rotate(180deg) translateY(-65px) scale(1.3);
          }
        }
        @keyframes pulse-dot-3 {
          0%, 100% {
            opacity: 0.3;
            transform: translate(-50%, -50%) rotate(270deg) translateY(-60px) scale(1);
          }
          50% {
            opacity: 0.7;
            transform: translate(-50%, -50%) rotate(270deg) translateY(-65px) scale(1.3);
          }
        }
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

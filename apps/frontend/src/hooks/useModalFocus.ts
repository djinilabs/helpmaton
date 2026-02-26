import { useEffect, useRef } from "react";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Trap focus inside a modal and restore focus to the trigger when closed.
 * Use with role="dialog" and aria-modal="true" on the modal container.
 */
export function useModalFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
): void {
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!isOpen) return;

    previousActiveElement.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Move focus into the modal (first focusable or the container); cancel if modal closes before RAF runs
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return;
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("keydown", handleKeyDown);
      const prev = previousActiveElement.current;
      previousActiveElement.current = null;
      if (prev?.focus && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [isOpen, containerRef]);
}

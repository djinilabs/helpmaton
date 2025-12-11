import { useCallback } from "react";

import { useLocalPreference } from "./useLocalPreference";

export const useAccordion = (pageId: string) => {
  const [expandedSection, setExpandedSection] = useLocalPreference<string | null>(
    `${pageId}-expanded-section`,
    null
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      setExpandedSection((current) => {
        // If clicking the same section, collapse it
        if (current === sectionId) {
          return null;
        }
        // Otherwise, expand the new section
        return sectionId;
      });
    },
    [setExpandedSection]
  );

  return {
    expandedSection,
    toggleSection,
  };
};


import { describe, expect, it } from "vitest";

import {
  DEFAULT_WIDGET_PREVIEW_SETTINGS,
  DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS,
  normalizeWidgetPreviewSettings,
  widgetPreviewSettingsFromSearchParams,
  widgetPreviewSettingsToSearchParams,
} from "../widgetPreviewSettings";

describe("widgetPreviewSettings utilities", () => {
  it("uses defaults when params are empty", () => {
    const params = new URLSearchParams();
    expect(widgetPreviewSettingsFromSearchParams(params)).toEqual(
      DEFAULT_WIDGET_PREVIEW_SETTINGS
    );
  });

  it("clamps and normalizes inputs", () => {
    const normalized = normalizeWidgetPreviewSettings({
      theme: "dark",
      fontFamily: "serif",
      fontSize: 9,
      backgroundColor: "",
      surfaceColor: "#111111",
    });

    expect(normalized.theme).toBe("dark");
    expect(normalized.fontFamily).toBe("serif");
    expect(normalized.fontSize).toBe(14);
    expect(normalized.backgroundColor).toBe(
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.backgroundColor
    );
    expect(normalized.surfaceColor).toBe("#111111");
  });

  it("builds query params for non-default settings", () => {
    const params = widgetPreviewSettingsToSearchParams({
      fontSize: 18,
      accentColor: "#ff0000",
    });

    expect(params.get("previewFontSize")).toBe("18");
    expect(params.get("previewAccentColor")).toBe("#ff0000");
    expect(params.get("previewTheme")).toBeNull();
  });

  it("ignores unsupported theme and font family values", () => {
    const normalized = normalizeWidgetPreviewSettings({
      theme: "sunset" as "light",
      fontFamily: "fantasy" as "system",
    });

    expect(normalized.theme).toBe(DEFAULT_WIDGET_PREVIEW_SETTINGS.theme);
    expect(normalized.fontFamily).toBe(DEFAULT_WIDGET_PREVIEW_SETTINGS.fontFamily);
  });

  it("swaps default palette when switching to dark theme", () => {
    const normalized = normalizeWidgetPreviewSettings({
      theme: "dark",
      backgroundColor: DEFAULT_WIDGET_PREVIEW_SETTINGS.backgroundColor,
      textColor: DEFAULT_WIDGET_PREVIEW_SETTINGS.textColor,
    });

    expect(normalized.backgroundColor).toBe(
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.backgroundColor
    );
    expect(normalized.textColor).toBe(
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.textColor
    );
  });
});

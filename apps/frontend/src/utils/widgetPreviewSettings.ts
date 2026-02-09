export type WidgetPreviewTheme = "light" | "dark";
export type WidgetPreviewFontFamily = "system" | "serif" | "mono";

export type WidgetPreviewSettings = {
  theme: WidgetPreviewTheme;
  fontFamily: WidgetPreviewFontFamily;
  fontSize: number;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
  borderColor: string;
};

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 20;

export const PREVIEW_FONT_SIZE_RANGE = {
  min: MIN_FONT_SIZE,
  max: MAX_FONT_SIZE,
} as const;

export const PREVIEW_FONT_FAMILIES: Record<
  WidgetPreviewFontFamily,
  { label: string; css: string }
> = {
  system: {
    label: "Inter / System",
    css: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  },
  serif: {
    label: "Serif",
    css: `Georgia, "Times New Roman", Times, serif`,
  },
  mono: {
    label: "Monospace",
    css: `"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
  },
};

export const DEFAULT_WIDGET_PREVIEW_SETTINGS: WidgetPreviewSettings = {
  theme: "light",
  fontFamily: "system",
  fontSize: 16,
  backgroundColor: "#fafaf9",
  surfaceColor: "#ffffff",
  textColor: "#1c1917",
  mutedTextColor: "#57534e",
  accentColor: "#3b82f6",
  borderColor: "#e7e5e4",
};

export const DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS: WidgetPreviewSettings = {
  theme: "dark",
  fontFamily: "system",
  fontSize: 16,
  backgroundColor: "#0c0a09",
  surfaceColor: "#1c1917",
  textColor: "#fafaf9",
  mutedTextColor: "#a8a29e",
  accentColor: "#60a5fa",
  borderColor: "#292524",
};

const clampFontSize = (value?: number | null) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_WIDGET_PREVIEW_SETTINGS.fontSize;
  }
  return Math.min(
    MAX_FONT_SIZE,
    Math.max(MIN_FONT_SIZE, Math.round(numericValue))
  );
};

const normalizeTheme = (value?: string | null): WidgetPreviewTheme => {
  if (value === "dark") {
    return "dark";
  }
  return "light";
};

const normalizeFontFamily = (value?: string | null): WidgetPreviewFontFamily => {
  if (value === "serif" || value === "mono" || value === "system") {
    return value;
  }
  return DEFAULT_WIDGET_PREVIEW_SETTINGS.fontFamily;
};

const normalizeColor = (value?: string | null, fallback?: string) => {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback ?? DEFAULT_WIDGET_PREVIEW_SETTINGS.backgroundColor;
};

const resolveThemeColor = (
  value: string | null | undefined,
  themeDefault: string,
  lightDefault: string,
  darkDefault: string
) => {
  if (!value) {
    return themeDefault;
  }
  if (themeDefault === darkDefault && value === lightDefault) {
    return darkDefault;
  }
  if (themeDefault === lightDefault && value === darkDefault) {
    return lightDefault;
  }
  return value;
};

export const normalizeWidgetPreviewSettings = (
  input: Partial<WidgetPreviewSettings>
): WidgetPreviewSettings => {
  const theme = normalizeTheme(input.theme);
  const themeDefaults =
    theme === "dark"
      ? DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS
      : DEFAULT_WIDGET_PREVIEW_SETTINGS;
  return {
    theme,
    fontFamily: normalizeFontFamily(input.fontFamily),
    fontSize: clampFontSize(input.fontSize),
    backgroundColor: resolveThemeColor(
      normalizeColor(input.backgroundColor, themeDefaults.backgroundColor),
      themeDefaults.backgroundColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.backgroundColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.backgroundColor
    ),
    surfaceColor: resolveThemeColor(
      normalizeColor(input.surfaceColor, themeDefaults.surfaceColor),
      themeDefaults.surfaceColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.surfaceColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.surfaceColor
    ),
    textColor: resolveThemeColor(
      normalizeColor(input.textColor, themeDefaults.textColor),
      themeDefaults.textColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.textColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.textColor
    ),
    mutedTextColor: resolveThemeColor(
      normalizeColor(input.mutedTextColor, themeDefaults.mutedTextColor),
      themeDefaults.mutedTextColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.mutedTextColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.mutedTextColor
    ),
    accentColor: resolveThemeColor(
      normalizeColor(input.accentColor, themeDefaults.accentColor),
      themeDefaults.accentColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.accentColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.accentColor
    ),
    borderColor: resolveThemeColor(
      normalizeColor(input.borderColor, themeDefaults.borderColor),
      themeDefaults.borderColor,
      DEFAULT_WIDGET_PREVIEW_SETTINGS.borderColor,
      DEFAULT_WIDGET_PREVIEW_DARK_SETTINGS.borderColor
    ),
  };
};

export const widgetPreviewSettingsFromSearchParams = (
  params: URLSearchParams
) =>
  normalizeWidgetPreviewSettings({
    theme: params.get("previewTheme") as WidgetPreviewTheme | undefined,
    fontFamily: params.get("previewFontFamily") as
      | WidgetPreviewFontFamily
      | undefined,
    fontSize: params.get("previewFontSize")
      ? Number(params.get("previewFontSize"))
      : undefined,
    backgroundColor: params.get("previewBackgroundColor") || undefined,
    surfaceColor: params.get("previewSurfaceColor") || undefined,
    textColor: params.get("previewTextColor") || undefined,
    mutedTextColor: params.get("previewMutedTextColor") || undefined,
    accentColor: params.get("previewAccentColor") || undefined,
    borderColor: params.get("previewBorderColor") || undefined,
  });

export const widgetPreviewSettingsToSearchParams = (
  settings: Partial<WidgetPreviewSettings>
) => {
  const normalized = normalizeWidgetPreviewSettings(settings);
  const params = new URLSearchParams();
  if (normalized.theme !== DEFAULT_WIDGET_PREVIEW_SETTINGS.theme) {
    params.set("previewTheme", normalized.theme);
  }
  if (normalized.fontFamily !== DEFAULT_WIDGET_PREVIEW_SETTINGS.fontFamily) {
    params.set("previewFontFamily", normalized.fontFamily);
  }
  if (normalized.fontSize !== DEFAULT_WIDGET_PREVIEW_SETTINGS.fontSize) {
    params.set("previewFontSize", String(normalized.fontSize));
  }
  if (normalized.backgroundColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.backgroundColor) {
    params.set("previewBackgroundColor", normalized.backgroundColor);
  }
  if (normalized.surfaceColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.surfaceColor) {
    params.set("previewSurfaceColor", normalized.surfaceColor);
  }
  if (normalized.textColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.textColor) {
    params.set("previewTextColor", normalized.textColor);
  }
  if (normalized.mutedTextColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.mutedTextColor) {
    params.set("previewMutedTextColor", normalized.mutedTextColor);
  }
  if (normalized.accentColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.accentColor) {
    params.set("previewAccentColor", normalized.accentColor);
  }
  if (normalized.borderColor !== DEFAULT_WIDGET_PREVIEW_SETTINGS.borderColor) {
    params.set("previewBorderColor", normalized.borderColor);
  }
  return params;
};

export const resolveWidgetPreviewFontFamily = (
  fontFamily: WidgetPreviewFontFamily
) => PREVIEW_FONT_FAMILIES[fontFamily].css;

import { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { useAgent, useAgentKeys } from "../hooks/useAgents";
import {
  resolveWidgetPreviewFontFamily,
  widgetPreviewSettingsFromSearchParams,
} from "../utils/widgetPreviewSettings";

// Declare global AgentWidget type
declare global {
  interface Window {
    AgentWidget?: {
      init: (options: {
        apiKey: string;
        workspaceId: string;
        agentId: string;
        theme?: "light" | "dark" | "auto";
        primaryColor?: string;
        backgroundColor?: string;
        textColor?: string;
        borderColor?: string;
        borderRadius?: string;
        outerBorderEnabled?: boolean;
        internalBorderThickness?: string;
        internalBorderColor?: string;
        fontFamily?: string;
        fontSize?: string;
        enableFileUpload?: boolean;
        tools?: Record<string, (...args: unknown[]) => Promise<unknown>>;
        baseUrl?: string;
        containerId: string;
      }) => void;
    };
  }
}

const WidgetPreview: FC = () => {
  const { workspaceId, agentId } = useParams<{
    workspaceId: string;
    agentId: string;
  }>();
  const [searchParams] = useSearchParams();
  const previewSettings = useMemo(
    () => widgetPreviewSettingsFromSearchParams(searchParams),
    [searchParams]
  );
  const previewFontFamily = useMemo(
    () => resolveWidgetPreviewFontFamily(previewSettings.fontFamily),
    [previewSettings.fontFamily]
  );
  const previewRootStyle = useMemo(
    () => ({
      fontFamily: previewFontFamily,
      fontSize: `${previewSettings.fontSize}px`,
    }),
    [previewFontFamily, previewSettings.fontSize]
  );

  const { data: agent } = useAgent(workspaceId!, agentId!);
  const { data: keys } = useAgentKeys(workspaceId!, agentId!);

  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [widgetInitialized, setWidgetInitialized] = useState(false);
  const widgetInitSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", previewSettings.theme === "dark");
    return () => {
      root.classList.remove("dark");
    };
  }, [previewSettings.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const variables: Record<string, string> = {
      "--preview-bg": previewSettings.backgroundColor,
      "--preview-surface": previewSettings.surfaceColor,
      "--preview-text": previewSettings.textColor,
      "--preview-muted": previewSettings.mutedTextColor,
      "--preview-accent": previewSettings.accentColor,
      "--preview-border": previewSettings.borderColor,
      "--preview-font-family": previewFontFamily,
      "--preview-font-size": `${previewSettings.fontSize}px`,
    };
    Object.entries(variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    return () => {
      Object.keys(variables).forEach((key) => {
        root.style.setProperty(key, "");
      });
    };
  }, [previewFontFamily, previewSettings]);

  // Load widget script
  useEffect(() => {
    if (!workspaceId || !agentId) return;

    // Check if script is already loaded
    const existingScript = document.querySelector('script[src*="widget.js"]');
    if (existingScript) {
      // Use setTimeout to defer state update
      setTimeout(() => {
        setScriptLoaded(true);
      }, 0);
      return;
    }

    const script = document.createElement("script");
    // Use relative path - widget.js should be served from the same origin
    // In production, this would be https://app.helpmaton.com/widget.js
    // In development, it should be available if the widget has been built
    script.src = "/widget.js";
    script.async = true;
    script.onload = () => {
      setScriptLoaded(true);
    };
    script.onerror = () => {
        setScriptError(
          "We couldn't load the widget preview. Ask a developer to build the widget package."
        );
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup: remove script if component unmounts
      const scriptToRemove = document.querySelector('script[src*="widget.js"]');
      if (scriptToRemove) {
        scriptToRemove.remove();
      }
    };
  }, [workspaceId, agentId]);

  // Initialize widget when script is loaded and agent data is available
  useEffect(() => {
    if (
      !scriptLoaded ||
      !agent ||
      !keys ||
      !workspaceId ||
      !agentId
    ) {
      return;
    }

    // Wait for AgentWidget to be available
    const initWidget = () => {
      const widgetKey = keys.find((k) => k.type === "widget");
      const widgetInitSignature = JSON.stringify({
        workspaceId,
        agentId,
        widgetKey: widgetKey?.key || "",
        search: searchParams.toString(),
        enabled: agent.widgetConfig?.enabled ?? false,
        theme: agent.widgetConfig?.theme || "auto",
      });
      if (widgetInitSignatureRef.current === widgetInitSignature) {
        return;
      }
      widgetInitSignatureRef.current = widgetInitSignature;

      // Check if widget is enabled
      if (!agent.widgetConfig?.enabled) {
        setTimeout(() => {
          setScriptError("The widget isn't enabled for this assistant.");
        }, 0);
        return;
      }

      // Find widget key
      if (!widgetKey?.key) {
        setTimeout(() => {
          setScriptError(
            "No widget key yet. Create one in the agent settings."
          );
        }, 0);
        return;
      }

      // Ensure widget container exists
      const containerId = "helpmaton-widget-container";
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement("div");
        container.id = containerId;
        // Position container in bottom right for demo
        // The widget will expand to fill this container
        container.style.position = "fixed";
        container.style.bottom = "20px";
        container.style.right = "20px";
        container.style.width = "400px";
        container.style.height = "600px";
        container.style.zIndex = "9999";
        document.body.appendChild(container);
      }

      if (window.AgentWidget) {
        try {
          // Read customization options from query params
          const primaryColor = searchParams.get("primaryColor") || undefined;
          const backgroundColor = searchParams.get("backgroundColor") || undefined;
          const textColor = searchParams.get("textColor") || undefined;
          const borderColor = searchParams.get("borderColor") || undefined;
          const borderRadius = searchParams.get("borderRadius") || undefined;
          const outerBorderEnabled = searchParams.get("outerBorderEnabled") === "true" ? true : searchParams.get("outerBorderEnabled") === "false" ? false : undefined;
          const internalBorderThickness = searchParams.get("internalBorderThickness") || undefined;
          const internalBorderColor = searchParams.get("internalBorderColor") || undefined;
          const fontFamily = searchParams.get("fontFamily") || undefined;
          const fontSize = searchParams.get("fontSize") || undefined;
          const enableFileUpload =
            searchParams.get("enableFileUpload") === "false"
              ? false
              : undefined;

          window.AgentWidget.init({
            apiKey: widgetKey.key!,
            workspaceId,
            agentId,
            theme: agent.widgetConfig?.theme || "auto",
            primaryColor,
            backgroundColor,
            textColor,
            borderColor,
            borderRadius,
            outerBorderEnabled,
            internalBorderThickness,
            internalBorderColor,
            fontFamily,
            fontSize,
            enableFileUpload,
            baseUrl: window.location.origin,
            containerId,
          });
          setTimeout(() => {
            setWidgetInitialized(true);
          }, 0);
        } catch (error) {
          setTimeout(() => {
            setScriptError(
              error instanceof Error
                ? error.message
                : "Failed to initialize widget"
            );
          }, 0);
        }
      } else {
        // Retry after a short delay
        setTimeout(initWidget, 100);
      }
    };

    initWidget();
  }, [
    scriptLoaded,
    agent,
    keys,
    widgetInitialized,
    workspaceId,
    agentId,
    searchParams,
  ]);

  if (scriptError) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[color:var(--preview-bg)] p-4 text-[color:var(--preview-text)]"
        style={previewRootStyle}
      >
        <div className="max-w-md rounded-lg border border-red-200 bg-[color:var(--preview-surface)] p-6 shadow-lg">
          <h2 className="mb-2 text-xl font-bold text-red-600">
            Widget preview isn&apos;t ready
          </h2>
          <p className="text-[color:var(--preview-muted)]">{scriptError}</p>
        </div>
      </div>
    );
  }

  if (!scriptLoaded || !widgetInitialized) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[color:var(--preview-bg)]"
        style={previewRootStyle}
      >
        <LoadingScreen />
      </div>
    );
  }

  // Fake e-commerce product page
  return (
    <div
      className="min-h-screen bg-[color:var(--preview-bg)] text-[color:var(--preview-text)]"
      style={previewRootStyle}
    >
      {/* Header */}
      <header className="border-b border-[color:var(--preview-border)] bg-[color:var(--preview-surface)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-[color:var(--preview-text)]">
                ShopDemo
              </h1>
            </div>
            <nav className="flex space-x-4">
              <a
                href="#"
                className="text-[color:var(--preview-muted)] transition-colors hover:text-[color:var(--preview-text)]"
              >
                Home
              </a>
              <a
                href="#"
                className="text-[color:var(--preview-muted)] transition-colors hover:text-[color:var(--preview-text)]"
              >
                Products
              </a>
              <a
                href="#"
                className="text-[color:var(--preview-muted)] transition-colors hover:text-[color:var(--preview-text)]"
              >
                About
              </a>
              <a
                href="#"
                className="text-[color:var(--preview-muted)] transition-colors hover:text-[color:var(--preview-text)]"
              >
                Contact
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Product Image */}
          <div className="aspect-square overflow-hidden rounded-lg border border-[color:var(--preview-border)] bg-[color:var(--preview-surface)]">
            <div className="flex h-full items-center justify-center">
              <svg
                className="size-32 text-[color:var(--preview-muted)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>

          {/* Product Info */}
          <div>
            <h1 className="mb-4 text-4xl font-bold text-[color:var(--preview-text)]">
              Premium Wireless Headphones
            </h1>
            <p className="mb-4 text-2xl font-semibold text-[color:var(--preview-accent)]">
              $299.99
            </p>
            <p className="mb-6 text-[color:var(--preview-muted)]">
              Experience crystal-clear audio with our premium wireless headphones.
              Featuring active noise cancellation, 30-hour battery life, and
              premium comfort for all-day wear.
            </p>

            <div className="mb-6 space-y-2">
              <div className="flex items-center">
                <svg
                  className="mr-2 size-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[color:var(--preview-muted)]">
                  Active Noise Cancellation
                </span>
              </div>
              <div className="flex items-center">
                <svg
                  className="mr-2 size-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[color:var(--preview-muted)]">
                  30-Hour Battery Life
                </span>
              </div>
              <div className="flex items-center">
                <svg
                  className="mr-2 size-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[color:var(--preview-muted)]">
                  Premium Comfort Design
                </span>
              </div>
            </div>

            <button className="mb-8 w-full rounded-lg bg-[color:var(--preview-accent)] px-6 py-3 text-lg font-semibold text-white shadow-lg transition-all hover:opacity-90">
              Add to Cart
            </button>

            {/* Product Details */}
            <div className="border-t border-[color:var(--preview-border)] pt-6">
              <h2 className="mb-4 text-xl font-semibold text-[color:var(--preview-text)]">
                Product Details
              </h2>
              <ul className="space-y-2 text-[color:var(--preview-muted)]">
                <li>• Wireless connectivity with Bluetooth 5.0</li>
                <li>• Quick charge: 10 minutes for 3 hours of playback</li>
                <li>• Premium leather ear cushions</li>
                <li>• Compatible with all devices</li>
                <li>• 2-year warranty included</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-12 border-t border-[color:var(--preview-border)] pt-8">
          <h2 className="mb-6 text-2xl font-semibold text-[color:var(--preview-text)]">
            Customer Reviews
          </h2>
          <div className="space-y-6">
            <div className="rounded-lg border border-[color:var(--preview-border)] bg-[color:var(--preview-surface)] p-6">
              <div className="mb-2 flex items-center">
                <div className="mr-4 size-10 rounded-full bg-[color:var(--preview-border)]"></div>
                <div>
                  <p className="font-semibold text-[color:var(--preview-text)]">
                    Sarah M.
                  </p>
                  <p className="text-sm text-[color:var(--preview-muted)]">
                    5 stars
                  </p>
                </div>
              </div>
              <p className="text-[color:var(--preview-muted)]">
                &quot;These headphones are absolutely amazing! The noise cancellation
                works perfectly, and the sound quality is outstanding. Worth every
                penny!&quot;
              </p>
            </div>
            <div className="rounded-lg border border-[color:var(--preview-border)] bg-[color:var(--preview-surface)] p-6">
              <div className="mb-2 flex items-center">
                <div className="mr-4 size-10 rounded-full bg-[color:var(--preview-border)]"></div>
                <div>
                  <p className="font-semibold text-[color:var(--preview-text)]">
                    John D.
                  </p>
                  <p className="text-sm text-[color:var(--preview-muted)]">
                    5 stars
                  </p>
                </div>
              </div>
              <p className="text-[color:var(--preview-muted)]">
                &quot;Best headphones I&apos;ve ever owned. The battery life is incredible,
                and they&apos;re so comfortable I can wear them all day.&quot;
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-[color:var(--preview-border)] bg-[color:var(--preview-surface)] py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center text-[color:var(--preview-muted)]">
            <p>© 2024 ShopDemo. All rights reserved.</p>
            <p className="mt-2 text-sm">
              This is a preview page to demonstrate the widget placement.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WidgetPreview;

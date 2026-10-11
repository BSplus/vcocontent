import { createRoot } from "react-dom/client";
import { useLayoutEffect, type ReactNode } from "react";
import App from "./App";
import "./index.css";

declare global {
  interface Window {
    __appStartup?: {
      committed(): void;
      failed(): void;
      reload(): void;
      showPublic(): void;
    };
  }
}

// A render() call only schedules work. This runs after the actual DOM commit,
// including an initial error-boundary fallback, without waiting for API/media.
function StartupCommit({ children }: { children: ReactNode }) {
  useLayoutEffect(() => { window.__appStartup?.committed(); }, []);
  return children;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  console.error("Root element not found!");
  window.__appStartup?.failed();
} else {
  console.log("Root element found, creating React root...");
  try {
    const root = createRoot(rootElement);
    console.log("React root created, attempting render...");
    root.render(<StartupCommit><App /></StartupCommit>);
  } catch (error) {
    console.error("Error during React initialization:", error);
    window.__appStartup?.failed();
  }
}
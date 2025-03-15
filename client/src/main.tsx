import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

console.log("React initialization starting...");

const rootElement = document.getElementById("root");
if (!rootElement) {
  console.error("Root element not found!");
} else {
  console.log("Root element found, creating React root...");
  try {
    const root = createRoot(rootElement);
    console.log("React root created, attempting render...");
    root.render(<App />);
    console.log("Initial render complete");
  } catch (error) {
    console.error("Error during React initialization:", error);
  }
}
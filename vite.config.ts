import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    themePlugin(),
    {
      name: "nonblocking-startup-styles",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          // A render-blocking stylesheet also blocks the inline startup shell.
          // Activate it on load; the React commit waits for its CSS marker.
          // No-JS visitors retain an ordinary stylesheet via noscript.
          return html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, link =>
            `${link.replace(/>$/, ` media="print" onload="this.media='all'">`)}<noscript>${link}</noscript>`);
        },
      },
    },
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});

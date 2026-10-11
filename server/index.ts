import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import session from "express-session";
import { storage } from "./storage";
import { registerSeoRoutes } from "./seo-routes";
import { verifyRecognitionSchema } from "./recognition-schema-readiness";

const app = express();

// Basic Express settings first
app.set("trust proxy", 1);

// Small event/series metadata may contain a thumbnail. Media files use the
// bounded multipart upload route, not JSON or database base64 payloads.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// The client and API are served from the same origin. Do not reflect arbitrary
// origins or enable credentialed cross-origin requests.
app.use((req, res, next) => {
  const origin = req.get("origin");
  const expectedOrigin = `${req.protocol}://${req.get("host")}`;

  if (origin && origin !== expectedOrigin) {
    return res.status(403).json({ error: "Cross-origin requests are not allowed" });
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

const isProduction = app.get("env") === "production";
const sessionSecret = process.env.SESSION_SECRET;
if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET must be configured for production");
}

// Configure and initialize a PostgreSQL-backed session store.
const sessionSettings: session.SessionOptions = {
  secret: sessionSecret || (isProduction ? "" : "development-only-session-secret"),
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  rolling: true,
  cookie: {
    secure: isProduction,
    sameSite: "lax",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  },
  name: "vco.sid"
};

app.use(session(sessionSettings));

setupAuth(app);

// Keep the development client usable while applying a restrictive production
// policy. Stripe's hosted payment fields are allowed; payment routes remain
// unavailable unless explicitly configured.
app.use((req, res, next) => {
  const scriptSources = ["'self'", "'unsafe-inline'", "https://js.stripe.com"];
  if (!isProduction) scriptSources.push("'unsafe-eval'");
  const frameAncestors = isProduction
    ? "frame-ancestors 'self'"
    : "frame-ancestors 'self' https://*.replit.dev https://*.replit.com";

  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' ws: wss: https://api.stripe.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error("Unhandled rejection:", reason);
});

(async () => {
  if (isProduction) await verifyRecognitionSchema();
  registerSeoRoutes(app);

  const server = await registerRoutes(app);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`Request failed for ${req.method} ${req.path}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({
      error: app.get("env") === "development" ? err.message : "Internal server error",
    });
  });

  const startServer = async (port: number): Promise<void> => {
    try {
      await new Promise<void>((resolve, reject) => {
        server.listen({
          port,
          host: "0.0.0.0",
          reusePort: true,
        }, () => {
          log(`Server running on port ${port}`);
          resolve();
        }).on('error', (error: any) => {
          if (error.code === 'EADDRINUSE' && process.env.PORT === undefined) {
            console.log(`Port ${port} is in use, trying next port...`);
            startServer(port + 1).then(resolve).catch(reject);
          } else {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  };

  const port = process.env.PORT === undefined ? 5000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  await startServer(port);
})().catch((error) => {
  console.error("Failed to initialize server:", error);
  process.exit(1);
});
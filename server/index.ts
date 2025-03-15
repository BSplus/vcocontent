import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import session from "express-session";
import { storage } from "./storage";

const app = express();

// Basic Express settings first
app.set("trust proxy", 1);

// Increase body parser limits to 250MB to accommodate base64 encoded files
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: false, limit: '250mb' }));

// Configure and initialize session first
const sessionSettings: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/'
  },
  name: 'vco.sid' // Custom name to avoid conflicts
};

// In development, allow non-secure cookies
if (process.env.NODE_ENV === 'development') {
  sessionSettings.cookie = {
    ...sessionSettings.cookie,
    secure: false,
    sameSite: 'lax'
  };
}

// Initialize session before any other middleware
app.use(session(sessionSettings));

// Set up auth (includes passport initialization)
setupAuth(app);

// CORS configuration for development
app.use((req, res, next) => {
  const origin = process.env.NODE_ENV === 'development'
    ? req.get('origin') || 'http://localhost:5000'
    : req.get('origin');

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// CSP configuration
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    // Remove any existing CSP headers
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('X-Content-Security-Policy');
    res.removeHeader('X-WebKit-CSP');
    log('Development mode: All CSP headers removed');
    next();
  });
} else {
  // Production CSP settings with WebSocket and Stripe security
  app.use((req, res, next) => {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const wsProtocol = isSecure ? 'wss' : 'ws';
    const host = req.get('host');

    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      `connect-src 'self' ${wsProtocol}://${host} https://api.stripe.com; ` +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com; " +
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com; " +
      "img-src 'self' data: blob: https://*.stripe.com https://raw.githubusercontent.com; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "media-src 'self' data: blob:;"
    );
    next();
  });
}

// Request logging middleware with detailed session info
app.use((req, res, next) => {
  const requestInfo = {
    path: req.path,
    method: req.method,
    sessionID: req.sessionID,
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user?.id,
    cookies: req.headers.cookie,
    sessionData: req.session
  };

  log(`Request to ${req.method} ${req.path}:`, JSON.stringify(requestInfo, null, 2));
  next();
});

// Global error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Global error:', err);
  log(`Error processing ${req.method} ${req.path}:`, err.toString());

  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

(async () => {
  const server = await registerRoutes(app);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Find an available port if 5000 is in use
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
          if (error.code === 'EADDRINUSE') {
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

  await startServer(5000);
})();
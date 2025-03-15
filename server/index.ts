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

// Make Replicate API token available to the frontend
if (process.env.REPLICATE_API_TOKEN) {
  process.env.VITE_REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  console.log('Replicate API token found and exposed to frontend');
} else {
  console.warn('Warning: REPLICATE_API_TOKEN not found in environment variables.');
}

// Development CSP settings - more permissive
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    // In development, allow everything for debugging
    res.removeHeader('Content-Security-Policy');
    next();
  });
} else {
  // Production CSP settings - more restrictive
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "connect-src 'self' ws: wss:; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-eval'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "media-src 'self' data: blob:"
    );
    next();
  });
}

// Set up session settings with proper configuration
const sessionSettings: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  name: 'vco.sid' // Custom name to avoid conflicts
};

// Initialize session before passport
app.use(session(sessionSettings));

// Set up auth (includes passport initialization)
setupAuth(app);

// Request logging middleware with detailed session info
app.use((req, res, next) => {
  console.log('Request:', {
    path: req.path,
    method: req.method,
    sessionID: req.sessionID,
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user?.id,
    cookies: req.headers.cookie,
    sessionData: req.session
  });
  next();
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
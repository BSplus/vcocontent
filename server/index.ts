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

// Configure and initialize session first
const sessionSettings: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  resave: true, // Changed to true to ensure session is saved on each request
  saveUninitialized: true, // Changed to true to create session on all requests
  store: storage.sessionStore,
  rolling: true, // Reset maxAge on every response
  cookie: {
    secure: true, // Must be true for SameSite=None to work in Replit
    sameSite: 'none', // Required for cross-origin requests in Replit proxy environment
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/'
  },
  name: 'vco.sid' // Custom name to avoid conflicts
};

// Initialize session before any other middleware
app.use(session(sessionSettings));

// Set up auth (includes passport initialization)
setupAuth(app);

// CSP configuration - Completely disable in development
app.use((req, res, next) => {
  // Remove any existing CSP headers
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  
  // Set a permissive CSP that allows everything for development
  res.setHeader('Content-Security-Policy', "default-src * 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;");
  next();
});

// Enhanced request logging middleware
app.use((req, res, next) => {
  // Only log API requests
  if (req.path.startsWith('/api')) {
    const details = {
      method: req.method,
      path: req.path,
      cookies: req.headers.cookie,
      sessionID: req.sessionID,
      isAuthenticated: req.isAuthenticated?.(),
      user: req.user ? {
        id: req.user.id,
        username: req.user.username,
        isAdmin: req.user.isAdmin,
        isCreator: req.user.isCreator
      } : 'Not logged in'
    };
    
    log(`Request details for ${req.method} ${req.path}`, '');
    console.log(details); // Using console.log for object output
  }
  next();
});

// Global error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Global error:', err);
  log(`Error processing ${req.method} ${req.path}:`, err.toString());

  // Send detailed error in development
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
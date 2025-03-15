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

// Less restrictive CSP in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', 
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss: *; " +
      "connect-src 'self' ws: wss: *; " +
      "style-src 'self' 'unsafe-inline' *; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' *; " +
      "img-src 'self' data: blob: *; " +
      "font-src 'self' data: *"
    );
    next();
  });
} else {
  // Production CSP settings
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "connect-src 'self' ws: wss:; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-eval'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:"
    );
    next();
  });
}

// Set up session first before any other middleware
const sessionSettings: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-key',
  resave: true,
  saveUninitialized: true,
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

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  // Add detailed session info to logs for debugging
  console.log('Request:', {
    path,
    method: req.method,
    sessionID: req.sessionID,
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user?.id,
    cookies: req.headers.cookie,
    sessionData: req.session
  });

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't exit to keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit to keep server running
});

(async () => {
  const server = await registerRoutes(app);

  // Better error handling for large files
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Express error handler caught:', err);

    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        message: "File size too large. Maximum size is 200MB for videos and 10MB for images."
      });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Always try to send a response, even for severe errors
    try {
      res.status(status).json({ message });
    } catch (responseError) {
      console.error('Failed to send error response:', responseError);
      // Try to send a simpler response if JSON response fails
      try {
        res.status(500).send('Internal Server Error');
      } catch (finalError) {
        console.error('Could not send any error response:', finalError);
      }
    }
  });

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
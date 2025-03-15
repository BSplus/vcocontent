import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { log } from "./vite";

// Extend Express User type for TypeScript
declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// Helper function for async encryption
const scryptAsync = promisify(scrypt);

// Function to securely hash passwords
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Function to compare passwords
async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Main function to set up authentication
export function setupAuth(app: Express) {
  // Session settings
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

  // Basic Express settings
  app.set("trust proxy", 1);

  // Initialize session before passport
  app.use(session(sessionSettings));

  // Initialize passport and session
  app.use(passport.initialize());
  app.use(passport.session());

  // Add request logging middleware for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      log(`Auth state for ${req.method} ${req.path}:`, 'auth');
      log(`- isAuthenticated: ${req.isAuthenticated()}`, 'auth');
      log(`- Session ID: ${req.sessionID}`, 'auth');
      log(`- User: ${req.user ? `ID: ${req.user.id}, Admin: ${req.user.isAdmin}, Creator: ${req.user.isCreator}` : 'Not logged in'}`, 'auth');
      log(`- Cookie present: ${!!req.headers.cookie}`, 'auth');
    }
    next();
  });

  // Passport strategy setup
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        log(`Login attempt for user: ${username}`, 'auth');
        const user = await storage.getUserByUsername(username);

        if (!user) {
          log(`Login failed: User ${username} not found`, 'auth');
          return done(null, false, { message: 'Invalid username or password' });
        }

        const isValid = await comparePasswords(password, user.password);
        log(`Login ${isValid ? 'successful' : 'failed'} for user: ${username}`, 'auth');

        return done(null, isValid ? user : false, 
          isValid ? undefined : { message: 'Invalid username or password' }
        );
      } catch (error) {
        log(`Login error for ${username}: ${error}`, 'auth');
        return done(error);
      }
    }),
  );

  // User session management
  passport.serializeUser((user, done) => {
    log(`Serializing user: ${user.id}`, 'auth');
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      log(`Deserialized user ${id}: ${user ? 'success' : 'not found'}`, 'auth');
      done(null, user);
    } catch (error) {
      log(`Deserialization error for user ${id}: ${error}`, 'auth');
      done(error);
    }
  });

  // Registration endpoint
  app.post("/api/register", async (req, res, next) => {
    try {
      log(`Registration attempt for username: ${req.body.username}`, 'auth');

      if (!req.body.username || !req.body.password) {
        log('Registration failed: Missing username or password', 'auth');
        return res.status(400).json({ error: "Username and password are required" });
      }

      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        log(`Registration failed: Username ${req.body.username} already exists`, 'auth');
        return res.status(400).json({ error: "Username already exists" });
      }

      const allUsers = await storage.getAllUsers();
      const isFirstUser = allUsers.length === 0;
      log(`Creating new user: ${req.body.username} (isFirstUser: ${isFirstUser})`, 'auth');

      const user = await storage.createUser({
        username: req.body.username,
        password: await hashPassword(req.body.password),
        isAdmin: isFirstUser
      });

      req.login(user, (err) => {
        if (err) {
          log(`Auto-login failed for new user: ${err}`, 'auth');
          return next(err);
        }
        log(`Registration successful for: ${user.username}`, 'auth');
        res.status(201).json(user);
      });
    } catch (error) {
      log(`Registration error: ${error}`, 'auth');
      res.status(500).json({ error: "Internal server error during registration" });
    }
  });

  // Login endpoint with better error handling
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        log(`Login error: ${err}`, 'auth');
        return next(err);
      }
      if (!user) {
        log('Login failed: Invalid credentials', 'auth');
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
          log(`Login session error: ${err}`, 'auth');
          return next(err);
        }
        log(`Login successful for user: ${user.username}`, 'auth');
        res.json(user);
      });
    })(req, res, next);
  });

  // Logout endpoint
  app.post("/api/logout", (req, res, next) => {
    const username = req.user?.username;
    req.logout((err) => {
      if (err) {
        log(`Logout error for user ${username}: ${err}`, 'auth');
        return next(err);
      }
      log(`Logout successful for user: ${username}`, 'auth');
      res.sendStatus(200);
    });
  });

  // User info endpoint
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      log('User info request: Not authenticated', 'auth');
      return res.sendStatus(401);
    }
    log(`User info request successful for: ${req.user.username}`, 'auth');
    res.json(req.user);
  });
}
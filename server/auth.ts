import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
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
  try {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    log('Password comparison error:', error?.toString() || 'Unknown error');
    return false;
  }
}

// Main function to set up authentication
export function setupAuth(app: Express) {
  log('Setting up authentication', 'auth');

  // Initialize passport middleware first
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport user serialization
  passport.serializeUser((user: Express.User, done) => {
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
      done(null, false); // Instead of passing error, return false to prevent middleware crash
    }
  });

  // Passport strategy setup
  passport.use(
    new LocalStrategy({
      usernameField: 'username',
      passwordField: 'password',
      session: true,
      passReqToCallback: false
    }, async (username: string, password: string, done) => {
      try {
        log(`Login attempt for user: ${username}`, 'auth');
        const user = await storage.getUserByUsername(username);

        if (!user) {
          log(`Login failed: User ${username} not found`, 'auth');
          return done(null, false, { message: 'Benutzername oder Passwort ist falsch' });
        }

        const isValid = await comparePasswords(password, user.password);
        log(`Login ${isValid ? 'successful' : 'failed'} for user: ${username}`, 'auth');

        return done(null, isValid ? user : false, 
          isValid ? undefined : { message: 'Benutzername oder Passwort ist falsch' }
        );
      } catch (error) {
        log(`Login error for ${username}: ${error}`, 'auth');
        return done(null, false, { message: 'Ein interner Fehler ist aufgetreten.' });
      }
    }),
  );

  // Add detailed request logging middleware for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      log(`Auth state for ${req.method} ${req.path}:`, 'auth');
      log(`- isAuthenticated: ${req.isAuthenticated?.()}`, 'auth');
      log(`- Session ID: ${req.sessionID}`, 'auth');
      log(`- Session Cookie: ${req.headers.cookie}`, 'auth');
      log(`- User: ${req.user ? `ID: ${req.user.id}, Admin: ${req.user.isAdmin}, Creator: ${req.user.isCreator}` : 'Nicht eingeloggt'}`, 'auth');
      if (req.session) {
        console.log('Session data:', req.session);
      }
    }
    next();
  });

  // Login endpoint with enhanced error handling
  app.post("/api/login", (req, res, next) => {
    if (!req.body.username || !req.body.password) {
      return res.status(400).json({ error: "Benutzername und Passwort sind erforderlich" });
    }

    console.log('Login request received:', {
      username: req.body.username,
      headers: req.headers,
      sessionID: req.sessionID
    });
    log(`Login request for user: ${req.body.username}`, 'auth');

    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) {
        log(`Login error: ${err}`, 'auth');
        return res.status(500).json({ error: "Ein Fehler ist aufgetreten" });
      }

      if (!user) {
        log('Login failed: Invalid credentials', 'auth');
        return res.status(401).json({ error: info?.message || "Benutzername oder Passwort ist falsch" });
      }

      req.login(user, (err) => {
        if (err) {
          log(`Login session error: ${err}`, 'auth');
          return res.status(500).json({ error: "Ein Fehler ist aufgetreten" });
        }
        log(`Login successful for user: ${user.username}`, 'auth');
        console.log('Session after login:', {
          sessionID: req.sessionID,
          user: user.username,
          cookie: req.session?.cookie
        });
        res.json(user);
      });
    })(req, res, next);
  });

  // User info endpoint
  app.get("/api/user", (req, res) => {
    console.log('User info request:', {
      isAuthenticated: req.isAuthenticated?.(),
      sessionID: req.sessionID,
      headers: req.headers,
      user: req.user
    });
    log(`User info request - Session ID: ${req.sessionID}`, 'auth');

    if (!req.isAuthenticated?.()) {
      log('User info request: Not authenticated', 'auth');
      return res.status(401).json({ error: "Nicht eingeloggt" });
    }
    log(`User info request successful for: ${req.user.username}`, 'auth');
    res.json(req.user);
  });

  // Logout endpoint
  app.post("/api/logout", (req, res) => {
    const username = req.user?.username;
    req.logout((err) => {
      if (err) {
        log(`Logout error for user ${username}: ${err}`, 'auth');
        return res.status(500).json({ error: "Ein Fehler ist aufgetreten" });
      }
      log(`Logout successful for user: ${username}`, 'auth');
      res.sendStatus(200);
    });
  });

  // Registration endpoint
  app.post("/api/register", async (req, res, next) => {
    try {
      if (!req.body.username || !req.body.password) {
        return res.status(400).json({ error: "Benutzername und Passwort sind erforderlich" });
      }

      console.log('Registration request received:', {
        username: req.body.username,
        sessionID: req.sessionID
      });
      log(`Registration request for username: ${req.body.username}`, 'auth');

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        log(`Registration failed: Username ${req.body.username} already exists`, 'auth');
        return res.status(400).json({ error: "Benutzername existiert bereits" });
      }

      // Hash the password
      const hashedPassword = await hashPassword(req.body.password);

      // Create the user
      const user = await storage.createUser({
        ...req.body,
        password: hashedPassword,
        isAdmin: false,
        isCreator: false,
        creatorStatus: 'pending',
        credits: 0
      });

      log(`User registered successfully: ${user.username}`, 'auth');

      // Log the user in automatically
      req.login(user, (err) => {
        if (err) {
          log(`Auto-login after registration failed: ${err}`, 'auth');
          return next(err);
        }
        log(`Auto-login after registration successful for: ${user.username}`, 'auth');
        res.status(201).json(user);
      });
    } catch (error) {
      log(`Registration error: ${error}`, 'auth');
      res.status(500).json({ error: "Ein Fehler ist bei der Registrierung aufgetreten" });
    }
  });
}
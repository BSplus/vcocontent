import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";

// Erweiterung des Express-User-Typs für TypeScript
declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// Hilfsfunktion für asynchrone Verschlüsselung
const scryptAsync = promisify(scrypt);

// Funktion zum sicheren Hashen von Passwörtern
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Funktion zum Vergleichen von Passwörtern
async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Hauptfunktion zur Einrichtung der Authentifizierung
export function setupAuth(app: Express) {
  // Sitzungseinstellungen
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
  };

  // Grundlegende Express-Einstellungen
  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport-Strategie für lokale Authentifizierung
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        } else {
          return done(null, user);
        }
      } catch (error) {
        return done(error);
      }
    }),
  );

  // Benutzer-Sitzungsverwaltung
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Registrierungsendpunkt
  app.post("/api/register", async (req, res, next) => {
    try {
      if (!req.body.username || !req.body.password) {
        return res.status(400).send("Benutzername und Passwort sind erforderlich");
      }

      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).send("Benutzername existiert bereits");
      }

      // Prüfe, ob dies der erste Benutzer ist
      const allUsers = await storage.getAllUsers();
      const isFirstUser = allUsers.length === 0;

      const user = await storage.createUser({
        username: req.body.username,
        password: await hashPassword(req.body.password),
        isAdmin: isFirstUser // Erster Benutzer wird automatisch Administrator
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (error) {
      console.error('Registrierungsfehler:', error);
      res.status(500).send("Interner Serverfehler bei der Registrierung");
    }
  });

  // Login-Endpunkt
  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(req.user);
  });

  // Logout-Endpunkt
  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  // Benutzerinfos-Endpunkt
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });
}
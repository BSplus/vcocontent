import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { log } from "./vite";
import { checkContent } from "./content-safety";
import { sendVerification, registerVerificationRoutes } from "./email-verification";
import { takeBetaRate } from "./beta-policy";
import { createHash } from "crypto";

// Extend Express User type for TypeScript
declare global {
  namespace Express {
    interface User extends Omit<SelectUser, "password"> {}
  }
}

function toSafeUser(user: SelectUser): Express.User {
  const { password, ...safeUser } = user;
  return safeUser;
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
    if (!hashed || !salt) return false;
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    if (hashedBuf.length !== suppliedBuf.length) return false;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    log("Password comparison failed", "auth");
    return false;
  }
}

// Main function to set up authentication
export function setupAuth(app: Express) {
  log('Setting up authentication', 'auth');
  app.use("/api",(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});

  app.use(passport.initialize());
  app.use(passport.session());
  registerVerificationRoutes(app);

  passport.serializeUser((user: Express.User, done) => done(null, user.id));

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      log("Session user lookup failed", "auth");
      done(error);
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
        const user = await storage.getUserByUsername(username);

        if (!user) {
          return done(null, false, { message: 'Invalid username or password' });
        }

        const isValid = await comparePasswords(password, user.password);
        return done(null, isValid && !user.suspended ? toSafeUser(user) : false,
          isValid ? undefined : { message: 'Invalid username or password' });
      } catch (error) {
        log("Login failed due to an internal error", "auth");
        return done(null, false, { message: 'An internal error has occurred.' });
      }
    }),
  );

  app.post("/api/login", (req, res, next) => {
    if (
      typeof req.body?.username !== "string" ||
      typeof req.body?.password !== "string" ||
      req.body.username.length > 256 ||
      req.body.password.length > 1024
    ) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) {
        log("Login session initialization failed", "auth");
        return res.status(500).json({ error: "An error has occurred" });
      }

      if (!user) {
        return res.status(401).json({ error: info?.message || "Invalid username or password" });
      }

      req.login(user, (err) => {
        if (err) {
          log("Login session initialization failed", "auth");
          return res.status(500).json({ error: "An error has occurred" });
        }
        
        req.session.save((saveErr) => {
          if (saveErr) {
            log("Login session could not be saved", "auth");
            return res.status(500).json({ error: "Failed to save session" });
          }
          
          res.json(user);
        });
      });
    })(req, res, next);
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated?.()) {
      return res.status(401).json({ error: "Not logged in" });
    }
    res.json(req.user);
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        log("Logout failed", "auth");
        return res.status(500).json({ error: "An error has occurred" });
      }
      req.session.destroy((destroyError) => {
        if (destroyError) {
          log("Logout session cleanup failed", "auth");
          return res.status(500).json({ error: "An error has occurred" });
        }
        res.clearCookie("vco.sid", { path: "/" });
        res.sendStatus(200);
      });
    });
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const body = req.body;
      if (!await takeBetaRate(`register:${createHash("sha256").update(req.ip || "").digest("hex")}`,10,3600000))
        return res.status(429).json({error:"Too many registrations. Please try later."});
      if (body?.profileImage) return res.status(400).json({error:"External profile images are not available during the beta."});
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        (body.requestCreator !== undefined && typeof body.requestCreator !== "boolean")
      ) {
        return res.status(400).json({ error: "Invalid registration data" });
      }

      // Validate and explicitly whitelist user-editable fields. Ignore client
      // attempts to set roles, credits, or moderation state.
      const parsedUser = insertUserSchema.safeParse({
        username: body.username,
        email: body.email,
        password: body.password,
        bio: body.bio,
        profileImage: body.profileImage,
      });
      if (!parsedUser.success) {
        return res.status(400).json({
          error: "Invalid registration data",
          details: parsedUser.error.flatten().fieldErrors,
        });
      }

      const { username, email, password, bio, profileImage } = parsedUser.data;
      const safety = await checkContent(JSON.stringify({username,bio}));
      if (safety.status!=="approved") return res.status(safety.status==="error"?503:400).json({
        error:"Your public username and biography could not be approved. Please use neutral wording or try later.",
      });
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      const hashedPassword = await hashPassword(password);

      const isCreatorRequest = body.requestCreator === true;
      const user = await storage.createUser({
        username,
        email,
        ...(bio !== undefined ? { bio } : {}),
        ...(profileImage !== undefined ? { profileImage } : {}),
        password: hashedPassword,
        requestCreator: isCreatorRequest,
      });
      const verification = await sendVerification(user).catch(()=>({
        status:503,sent:false,error:"Verification email could not be sent. Please try again from your account.",
      }));

      req.login(user, (err) => {
        if (err) {
          log("Registration login initialization failed", "auth");
          return next(err);
        }
        
        req.session.save((saveErr) => {
          if (saveErr) {
            log("Registration session could not be saved", "auth");
            return res.status(500).json({ error: "Failed to save session" });
          }
          
          res.status(201).json({...user,verificationSent:verification.sent===true,verificationError:verification.error});
        });
      });
    } catch (error) {
      log("Registration failed due to an internal error", "auth");
      res.status(500).json({ error: "An error occurred during registration" });
    }
  });
}
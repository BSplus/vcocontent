import { Request, Response, NextFunction } from "express";
import { log } from "../vite";

// Middleware to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  log(`Authentication check for ${req.method} ${req.path}`, 'auth');
  log(`Session ID: ${req.sessionID}`, 'auth');
  log(`Is Authenticated: ${req.isAuthenticated()}`, 'auth');
  log(`User: ${req.user ? JSON.stringify(req.user) : 'Not logged in'}`, 'auth');

  if (!req.isAuthenticated()) {
    log('Authentication failed - user not authenticated', 'auth');
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Middleware to check if user is an admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  log(`Admin check for ${req.method} ${req.path}`, 'auth');
  log(`User: ${req.user ? JSON.stringify(req.user) : 'Not logged in'}`, 'auth');

  if (!req.isAuthenticated() || !req.user?.isAdmin) {
    log('Admin access denied', 'auth');
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Middleware to check if user is a creator
export function requireCreator(req: Request, res: Response, next: NextFunction) {
  log(`Creator check for ${req.method} ${req.path}`, 'auth');
  log(`User: ${req.user ? JSON.stringify(req.user) : 'Not logged in'}`, 'auth');

  if (!req.isAuthenticated()) {
    log('Creator access denied - not authenticated', 'auth');
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!req.user?.isCreator && !req.user?.isAdmin) {
    log('Creator access denied - not a creator or admin', 'auth');
    return res.status(403).json({ error: "Creator access required" });
  }

  next();
}

// Middleware to check if user owns the resource or is an admin
export function requireOwnershipOrAdmin(resourceCreatorIdField: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    log(`Ownership check for ${req.method} ${req.path}`, 'auth');
    log(`User: ${req.user ? JSON.stringify(req.user) : 'Not logged in'}`, 'auth');
    log(`Resource creator field: ${resourceCreatorIdField}`, 'auth');

    if (!req.isAuthenticated()) {
      log('Ownership check failed - not authenticated', 'auth');
      return res.status(401).json({ error: "Authentication required" });
    }

    // Allow admins to access all resources
    if (req.user.isAdmin) {
      log('Ownership check passed - user is admin', 'auth');
      return next();
    }

    // For creators, check if they own the resource
    const resourceCreatorId = req.body[resourceCreatorIdField] || req.params[resourceCreatorIdField];
    log(`Resource creator ID: ${resourceCreatorId}, User ID: ${req.user.id}`, 'auth');

    if (!resourceCreatorId || req.user.id !== parseInt(resourceCreatorId)) {
      log('Ownership check failed - user does not own resource', 'auth');
      return res.status(403).json({ error: "Unauthorized access to resource" });
    }

    log('Ownership check passed - user owns resource', 'auth');
    next();
  };
}
import { Request, Response, NextFunction } from "express";

// Middleware to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Middleware to check if user is an admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Middleware to check if user is a creator
export function requireCreator(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || (!req.user?.isCreator && !req.user?.isAdmin)) {
    return res.status(403).json({ error: "Creator access required" });
  }
  next();
}

// Middleware to check if user owns the resource or is an admin
export function requireOwnershipOrAdmin(resourceCreatorIdField: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Allow admins to access all resources
    if (req.user.isAdmin) {
      return next();
    }

    // For creators, check if they own the resource
    const resourceCreatorId = req.body[resourceCreatorIdField] || req.params[resourceCreatorIdField];
    if (!resourceCreatorId || req.user.id !== parseInt(resourceCreatorId)) {
      return res.status(403).json({ error: "Unauthorized access to resource" });
    }

    next();
  };
}

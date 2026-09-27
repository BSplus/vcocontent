import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

// Middleware to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Middleware to check if user is an admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Creator areas also allow admins and users with approved creator status.
export function requireCreator(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!user.isCreator && !user.isAdmin && user.creatorStatus !== 'approved') {
    return res.status(403).json({ error: "Creator access required" });
  }

  next();
}

// Middleware to check if user owns the resource or is an admin
export function requireOwnershipOrAdmin(resourceCreatorIdField: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Allow admins to access all resources
    if (req.user?.isAdmin) {
      return next();
    }

    // Event mutations use the persisted event's creatorId. Never trust a
    // client-supplied creator ID from the request body for authorization.
    if (resourceCreatorIdField !== "creatorId") {
      return res.status(500).json({ error: "Unsupported ownership resource" });
    }

    const resourceId = Number(req.params.id);
    if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({ error: "Invalid resource ID" });
    }

    try {
      const event = await storage.getEvent(resourceId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      if (!req.user || event.creatorId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized access to resource" });
      }
    } catch (error) {
      return next(error);
    }

    if (!req.user) {
      return res.status(403).json({ error: "Unauthorized access to resource" });
    }
    next();
  };
}
import express, { type Express, type ErrorRequestHandler, type Request } from "express";
import { PROFILE_JSON_BYTES, PROFILE_IMAGE_SIZE_MESSAGE } from "../shared/profile-image-limits";

const isProfileUpdate = (req: Request) =>
  req.method === "PATCH" && /^\/api\/account\/profile\/?$/i.test(req.path);
const isEventSave = (req: Request) =>
  ["POST", "PUT"].includes(req.method) && /^\/api\/events(?:\/[1-9][0-9]*)?$/.test(req.path);

// Used by both the application entry point and integration tests.
export function registerRequestParsers(app: Express) {
  const profileJson = express.json({ limit: PROFILE_JSON_BYTES });
  const eventJson = express.json({ limit: "3mb" }); // Two 1 MiB Base64 images plus event text.
  const standardJson = express.json({ limit: "2mb" });
  app.use((req, res, next) => (isProfileUpdate(req) ? profileJson : isEventSave(req) ? eventJson : standardJson)(req, res, next));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  const sizeError: ErrorRequestHandler = (error, req, res, next) => {
    if (error?.type !== "entity.too.large") return next(error);
    res.status(413).json({
      error: isProfileUpdate(req)
        ? `The profile request is too large. ${PROFILE_IMAGE_SIZE_MESSAGE}`
        : isEventSave(req)
          ? "Event image request is too large. Each thumbnail or cover image must not exceed 1 MiB."
          : "The request is too large. Send less data.",
    });
  };
  app.use(sizeError);
}

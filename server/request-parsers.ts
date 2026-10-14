import express, { type Express, type ErrorRequestHandler, type Request } from "express";
import { PROFILE_JSON_BYTES, PROFILE_IMAGE_SIZE_MESSAGE } from "../shared/profile-image-limits";
import { profileFailure } from "../shared/profile-errors";

const isProfileUpdate = (req: Request) =>
  req.method === "PATCH" && /^\/api\/account\/profile\/?$/i.test(req.path);
const isEventSave = (req: Request) =>
  ["POST", "PUT"].includes(req.method) && /^\/api\/events(?:\/[1-9][0-9]*)?$/.test(req.path);
const isSupport = (req: Request) => req.method === "POST" && /^\/api\/support\/?$/i.test(req.path);

// Used by both the application entry point and integration tests.
export function registerRequestParsers(app: Express) {
  const profileJson = express.json({ limit: PROFILE_JSON_BYTES });
  const eventJson = express.json({ limit: "3mb" }); // Two 1 MiB Base64 images plus event text.
  const standardJson = express.json({ limit: "2mb" });
  const supportJson = express.json({ limit: "24kb" });
  app.use((req, res, next) => (isSupport(req) ? supportJson : isProfileUpdate(req) ? profileJson : isEventSave(req) ? eventJson : standardJson)(req, res, next));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  const sizeError: ErrorRequestHandler = (error, req, res, next) => {
    if (isSupport(req) && ["entity.parse.failed", "entity.too.large"].includes(error?.type))
      return void res.status(error.type === "entity.too.large" ? 413 : 400).json({
        status: "validation", error: "The support request is invalid or too large. Please review the form.",
      });
    if (isProfileUpdate(req) && error?.type === "entity.parse.failed")
      return void res.status(400).json(profileFailure("validation"));
    if (error?.type !== "entity.too.large") return next(error);
    if (isProfileUpdate(req)) return void res.status(413).json(profileFailure("request_size"));
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

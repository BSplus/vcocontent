import { z } from "zod";
import { EventImageError } from "./event-thumbnails";
import { MediaLimitError } from "./media-policy";

export function eventCreationError(error: unknown) {
  if (error instanceof z.ZodError) {
    const labels: Record<string, string> = {
      title: "Title", description: "Description", date: "Date", seriesId: "Series",
      round: "Round", track: "Track", platform: "Platform",
    };
    const messages = error.issues.map(issue => {
      const label = labels[String(issue.path[0])] || "Event details";
      return `${label}: ${issue.code === "invalid_date" ? "Choose a valid date." : issue.message}`;
    });
    return { status: 400, message: `Check the event details. ${Array.from(new Set(messages)).join(" ")}` };
  }
  if (error instanceof EventImageError || error instanceof MediaLimitError ||
      error instanceof Error && error.message.startsWith("Entry list:"))
    return { status: 400, message: (error as Error).message };
  return { status: 503, message: "Event creation could not be confirmed. Check your event list before trying again." };
}

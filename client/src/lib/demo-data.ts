import { apiRequest } from "./queryClient";
import { InsertEvent, InsertMediaItem } from "@shared/schema";

const demoEvents: InsertEvent[] = [
  {
    title: "VCO Cup Finals 2025",
    description: "The ultimate showdown of sim racing talent at the VCO Cup Finals.",
    date: new Date("2025-03-15"),
    coverImage: "/attached_assets/%2389_3.png"
  },
  {
    title: "SimRacing World Championship",
    description: "Global sim racing stars compete for the championship title.",
    date: new Date("2025-03-20"),
    coverImage: "/attached_assets/%2389_3.png"
  }
];

async function createDemoEvent(event: InsertEvent) {
  try {
    const res = await apiRequest("POST", "/api/events", event);
    return await res.json();
  } catch (error) {
    console.error("Failed to create demo event:", error);
    return null;
  }
}

async function createDemoMediaItem(eventId: number, index: number) {
  const mediaItem: InsertMediaItem = {
    eventId,
    type: index % 3 === 0 ? "video" : "image",
    url: "/attached_assets/%2389_3.png",
    thumbnail: "/attached_assets/%2389_3.png",
    caption: `Racing moment ${index + 1}`,
    photographer: `Photographer ${index % 3 + 1}`,
    tags: ["racing", "competition", `tag${index + 1}`]
  };

  try {
    const res = await apiRequest("POST", "/api/media", mediaItem);
    return await res.json();
  } catch (error) {
    console.error("Failed to create demo media item:", error);
    return null;
  }
}

export async function createDemoContent() {
  for (const event of demoEvents) {
    const createdEvent = await createDemoEvent(event);
    if (createdEvent) {
      // Create 6 media items for each event
      for (let i = 0; i < 6; i++) {
        await createDemoMediaItem(createdEvent.id, i);
      }
    }
  }
}
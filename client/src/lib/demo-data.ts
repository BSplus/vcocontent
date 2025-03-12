import { apiRequest } from "./queryClient";
import { InsertEvent, InsertMediaItem } from "@shared/schema";

const demoEvents: InsertEvent[] = [
  {
    title: "VCO Cup Finals 2025",
    description: "The ultimate showdown of sim racing talent at the VCO Cup Finals.",
    date: new Date("2025-03-15").toISOString(),
    coverImage: "https://picsum.photos/seed/vco1/800/400"
  },
  {
    title: "SimRacing World Championship",
    description: "Global sim racing stars compete for the championship title.",
    date: new Date("2025-03-20").toISOString(),
    coverImage: "https://picsum.photos/seed/vco2/800/400"
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
    url: `https://picsum.photos/seed/media${eventId}${index}/1200/800`,
    thumbnail: `https://picsum.photos/seed/media${eventId}${index}/400/400`,
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

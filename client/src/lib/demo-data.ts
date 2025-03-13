import { apiRequest } from "./queryClient";
import { InsertEvent, InsertMediaItem } from "@shared/schema";

const demoEvents: InsertEvent[] = [
  {
    title: "DNLS Round 4",
    description: "Digital Nürburgring Langstrecken Serie - Round 4 featuring intense battles at the Green Hell.",
    date: new Date("2025-03-08"),
    coverImage: "/attached_assets/%2389_3.png"
  },
  {
    title: "International Endurance Series - Round 3",
    description: "Third round of the prestigious international endurance championship with top sim racing teams.",
    date: new Date("2025-03-01"),
    coverImage: "/attached_assets/%2389_3.png"
  }
];

const photographerNames = [
  "Max Photoracer",
  "Sarah Speedshot",
  "Tom Trackside",
  "Lisa Lenspro"
];

const racingTags = [
  "endurance", "qualifying", "race-action", "pit-stop", 
  "night-racing", "overtake", "podium", "grid-start",
  "race-finish", "team-celebration"
];

const mediaCaptions = [
  "Intense battle for the lead",
  "Perfect racing line through the apex",
  "Side-by-side action into turn one",
  "Night racing spectacular",
  "Dramatic finish under the lights",
  "Team celebration in the pitlane",
  "Focus before the race start",
  "Victory celebration on the podium"
];

async function createDemoEvent(event: InsertEvent) {
  try {
    console.log('Creating demo event:', event.title);
    const res = await apiRequest("POST", "/api/events", event);
    const createdEvent = await res.json();
    console.log('Created event:', createdEvent);
    return createdEvent;
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
    caption: mediaCaptions[index % mediaCaptions.length],
    photographer: photographerNames[index % photographerNames.length],
    tags: [
      racingTags[index % racingTags.length],
      racingTags[(index + 1) % racingTags.length],
      racingTags[(index + 2) % racingTags.length]
    ]
  };

  try {
    console.log('Creating demo media item for event:', eventId);
    const res = await apiRequest("POST", "/api/media", mediaItem);
    const createdMedia = await res.json();
    console.log('Created media item:', createdMedia);
    return createdMedia;
  } catch (error) {
    console.error("Failed to create demo media item:", error);
    return null;
  }
}

export async function createDemoContent() {
  console.log('Starting demo content creation...');
  for (const event of demoEvents) {
    const createdEvent = await createDemoEvent(event);
    if (createdEvent) {
      // Create 12 media items for each event to fill the grid nicely
      for (let i = 0; i < 12; i++) {
        await createDemoMediaItem(createdEvent.id, i);
      }
    }
  }
  console.log('Demo content creation completed');
}
import OpenAI from 'openai';
import {verifyPhotoObservations} from "./photo-number-evidence";
import {type Identification} from "@shared/schema";
import {localizePhotoNumbers} from "./photo-number-localizer";

export const TAG_MODEL = "gpt-4.1-mini";
export const controlledTags = [
  "Front View", "Rear View", "Aerial View", "Side View", "Onboard View",
  "Group", "Crash", "Atmosphere", "Day", "Night", "Rain", "Wet Track",
  "Dry Track", "GT Car", "Formula Car", "Prototype", "Vintage",
  "Front 3/4", "Rear 3/4", "Top Down", "Close-up", "Wide Shot", "Cockpit View",
  "Race Track", "Pit Lane", "Pit Box", "Garage", "Paddock", "Starting Grid", "Podium",
  "Studio", "Esports Arena", "Race Car", "Driver", "Helmet", "Cockpit", "Steering Wheel",
  "Wheel", "Trophy", "Team Members", "Crowd", "Racing Simulator", "Race Action",
  "Battle", "Overtaking", "Pit Stop", "Celebration", "Podium Ceremony", "Portrait",
  "Behind the Scenes", "Sunset", "Sim Racing", "Esports",
  "GT3", "GT4", "Stock Car", "Touring Car", "Rally",
];
const allowedTags = new Set(controlledTags);

export function parseTagResponse(text: string): string[] {
  return Array.from(new Set(text.split(',').map(tag => tag.trim()).filter(tag => allowedTags.has(tag))));
}

export function isAITaggingConfigured(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

export function getOpenAIClient(): OpenAI | null {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const managedKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (baseURL && managedKey) {
    return new OpenAI({ baseURL, apiKey: managedKey, fetch: globalThis.fetch });
  }
  return null;
}

// A fixed, low-cost probe. Do not return provider content or accept caller input.
export async function testManagedOpenAI(): Promise<boolean> {
  const openai = getOpenAIClient();
  if (!openai) return false;
  const response = await openai.chat.completions.create({
    model: TAG_MODEL,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 8,
  }, { timeout: 10000, maxRetries: 0 });
  return response.choices.some(choice =>
    choice.finish_reason === "stop" && Boolean(choice.message?.content?.trim()));
}

export async function generateTagsForImage(imageUrl: string): Promise<string[]> {
  const openai = getOpenAIClient();
  if (!openai) throw new Error('AI tagging is not configured');
  try {
    const response = await openai.chat.completions.create({
      model: TAG_MODEL,
      messages: [
        {
          role: "system",
          content: `Describe only visible evidence. Allowed tags: ${Array.from(allowedTags).join(", ")}. Use a short comma-separated list, no synonyms or guesses. Stock cars are not GT cars. Prefer Race Car when precise class is unknown.`,
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Analyze this sim racing image and identify which of the predefined tags apply. Only use tags from the list provided in your instructions. Format the response as a simple comma-separated list without numbering or bullet points." 
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 150,
    }, { timeout: 20000, maxRetries: 0 });

    const tagsText = response.choices[0]?.message?.content || '';
    return parseTagResponse(tagsText);
  } catch (error) {
    // Provider errors can contain request metadata. Never log or return them to clients.
    console.error('AI tagging provider request failed');
    throw new Error('AI tagging failed');
  }
}

export async function detectRaceNumbers(imageUrl: string): Promise<{ numbers: string[]; vehicles:Identification[]; scene: "Race Action" | "Start" | "Finish" | null }> {
  try {
    const localized=await localizePhotoNumbers(imageUrl);
    const verified=await verifyPhotoObservations(imageUrl,localized.vehicles);
    return {numbers:verified.map(v=>v.number).filter(Boolean),vehicles:verified,scene:localized.scene};
  } catch {
    throw new Error("Image number detection failed");
  }
}

export async function categorizeContent(tags: string[]): Promise<string> {
  {
    if (tags.includes("Formula Car")) return "Formula";
    if (tags.includes("GT Car")) return "GT Racing";
    if (tags.includes("Prototype")) return "Endurance";
    if (tags.includes("Vintage")) return "Historic Racing";
    if (tags.includes("Rain") || tags.includes("Wet Track")) return "Weather Conditions";
    if (tags.includes("Night")) return "Night Racing";
    if (tags.includes("Crash")) return "Racing Incident";

    return 'Other';
  }
}

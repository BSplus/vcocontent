import OpenAI from 'openai';

export const TAG_MODEL = "gpt-4.1-mini";
const allowedTags = new Set([
  "Front View", "Rear View", "Aerial View", "Side View", "Onboard View",
  "Group", "Crash", "Atmosphere", "Day", "Night", "Rain", "Wet Track",
  "Dry Track", "GT Car", "Formula Car", "Prototype", "Vintage",
]);

export function parseTagResponse(text: string): string[] {
  return Array.from(new Set(text.split(',').map(tag => tag.trim()).filter(tag => allowedTags.has(tag))));
}

export function isAITaggingConfigured(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

function getOpenAIClient(): OpenAI | null {
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
          content: "You are a specialized tagging system for sim racing images. Focus only on identifying the following aspects:\n- Camera angles: Front View, Rear View, Aerial View, Side View, Onboard View\n- Racing scenarios: Group, Crash, Atmosphere\n- Conditions: Day, Night, Rain, Wet Track, Dry Track\n- Car features: GT Car, Formula Car, Prototype, Vintage\nProvide ONLY these specific tags when applicable. Format your response as a simple comma-separated list."
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
    });

    const tagsText = response.choices[0]?.message?.content || '';
    return parseTagResponse(tagsText);
  } catch (error) {
    // Provider errors can contain request metadata. Never log or return them to clients.
    console.error('AI tagging provider request failed');
    throw new Error('AI tagging failed');
  }
}

export async function generateTagsForVideo(videoUrl: string, thumbnailUrl: string): Promise<string[]> {
  try {
    return await generateTagsForImage(thumbnailUrl);
  } catch (error) {
    throw error;
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

import OpenAI from 'openai';
import { log } from '../vite';

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function generateTagsForImage(imageUrl: string): Promise<string[]> {
  try {
    const openai = getOpenAIClient();
    if (!openai) {
      log('OpenAI API key not configured, skipping tag generation', 'ai-tagger');
      return [];
    }

    log(`Generating tags for image: ${imageUrl}`, 'ai-tagger');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision",
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
    const tags = tagsText
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    
    log(`Generated ${tags.length} tags for image`, 'ai-tagger');
    return tags;
  } catch (error) {
    log(`Error generating tags: ${error}`, 'ai-tagger');
    console.error('OpenAI API error:', error);
    return [];
  }
}

export async function generateTagsForVideo(videoUrl: string, thumbnailUrl: string): Promise<string[]> {
  try {
    log(`Generating tags for video using thumbnail: ${thumbnailUrl}`, 'ai-tagger');
    return await generateTagsForImage(thumbnailUrl);
  } catch (error) {
    log(`Error generating video tags: ${error}`, 'ai-tagger');
    console.error('OpenAI API error for video:', error);
    return [];
  }
}

export async function categorizeContent(tags: string[]): Promise<string> {
  try {
    log(`Categorizing content with tags: ${tags.join(', ')}`, 'ai-tagger');

    if (tags.includes("Formula Car")) return "Formula";
    if (tags.includes("GT Car")) return "GT Racing";
    if (tags.includes("Prototype")) return "Endurance";
    if (tags.includes("Vintage")) return "Historic Racing";
    if (tags.includes("Rain") || tags.includes("Wet Track")) return "Weather Conditions";
    if (tags.includes("Night")) return "Night Racing";
    if (tags.includes("Crash")) return "Racing Incident";

    const openai = getOpenAIClient();
    if (!openai) {
      return 'Other';
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a categorization expert for sim racing content. Given a set of tags, determine the most appropriate primary category from the following options: 'GT Racing', 'Formula', 'Rally', 'Endurance', 'Touring Car', 'Oval Racing', 'Historic Racing', 'Weather Conditions', 'Racing Incident', or 'Other'. Respond with just the category name."
        },
        {
          role: "user",
          content: `Determine the primary racing category for content with these tags: ${tags.join(', ')}`
        }
      ],
      max_tokens: 20,
    });

    const category = response.choices[0]?.message?.content?.trim() || 'Other';
    log(`Categorized as: ${category}`, 'ai-tagger');
    return category;
  } catch (error) {
    log(`Error categorizing content: ${error}`, 'ai-tagger');
    console.error('OpenAI API error for categorization:', error);
    return 'Other';
  }
}

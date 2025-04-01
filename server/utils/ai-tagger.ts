import OpenAI from 'openai';
import { log } from '../vite';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates tags for an image using OpenAI's Vision API
 * @param imageUrl The URL of the image to analyze
 * @returns Array of tags generated for the image
 */
export async function generateTagsForImage(imageUrl: string): Promise<string[]> {
  try {
    log(`Generating tags for image: ${imageUrl}`, 'ai-tagger');
    
    // Request to OpenAI Vision API
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

    // Extract the generated tags from the response
    const tagsText = response.choices[0]?.message?.content || '';
    
    // Clean up and process tags
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

/**
 * Generates tags for a video using OpenAI's API
 * This is a placeholder that would need to extract frames from the video
 * or send the video URL if it's directly processable
 * @param videoUrl The URL of the video to analyze
 * @returns Array of tags generated for the video
 */
export async function generateTagsForVideo(videoUrl: string, thumbnailUrl: string): Promise<string[]> {
  try {
    log(`Generating tags for video using thumbnail: ${thumbnailUrl}`, 'ai-tagger');
    
    // For now, we'll use the video's thumbnail for analysis
    // In a full implementation, you might extract multiple frames
    return await generateTagsForImage(thumbnailUrl);
  } catch (error) {
    log(`Error generating video tags: ${error}`, 'ai-tagger');
    console.error('OpenAI API error for video:', error);
    return [];
  }
}

/**
 * Categorizes content based on generated tags
 * @param tags Array of tags to categorize
 * @returns Primary category for the content
 */
export async function categorizeContent(tags: string[]): Promise<string> {
  try {
    log(`Categorizing content with tags: ${tags.join(', ')}`, 'ai-tagger');
    
    // Simple categorization logic based on specific sim racing tags
    // This avoids API calls and uses direct logic based on our predefined tags
    
    // Check for specific car types
    if (tags.includes("Formula Car")) return "Formula";
    if (tags.includes("GT Car")) return "GT Racing";
    if (tags.includes("Prototype")) return "Endurance";
    if (tags.includes("Vintage")) return "Historic Racing";
    
    // Check for specific conditions
    if (tags.includes("Rain") || tags.includes("Wet Track")) return "Weather Conditions";
    if (tags.includes("Night")) return "Night Racing";
    
    // Check for specific scenarios
    if (tags.includes("Crash")) return "Racing Incident";
    
    // Default fallback categorization using AI if needed
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
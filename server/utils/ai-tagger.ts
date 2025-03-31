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
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Analyze this sim racing image and provide exactly 5-10 relevant tags. These should be single words or very short phrases that describe key elements like: car models, tracks, racing conditions, camera angles, or notable features. Format the response as a simple comma-separated list without numbering or bullet points." 
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
      max_tokens: 300,
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
    
    // For a simple categorization, we'll use OpenAI to determine the primary category
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: "You are a categorization expert for racing content. Given a set of tags, determine the most appropriate primary category from the following options: 'GT Racing', 'Formula', 'Rally', 'Endurance', 'Drifting', 'Touring Car', 'Oval Racing', 'Offroad', 'Historic Racing', or 'Other'. Respond with just the category name."
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
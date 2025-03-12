"use strict";
import Replicate from 'replicate';

let replicate: Replicate | null = null;

function initializeReplicate() {
  if (!replicate) {
    const token = import.meta.env.VITE_REPLICATE_API_TOKEN;
    if (!token) {
      throw new Error('Replicate API token not found in environment variables');
    }
    replicate = new Replicate({
      auth: token,
    });
    console.log('Replicate client initialized successfully');
  }
  return replicate;
}

export async function generateEventThumbnail(title: string, description: string): Promise<string> {
  try {
    const client = initializeReplicate();
    console.log('Starting AI thumbnail generation for:', title);

    // Create a prompt that captures the essence of the event
    const prompt = `A photorealistic racing event scene for "${title}": ${description}. High quality, dramatic lighting, professional sports photography style.`;

    console.log('Generating with prompt:', prompt);

    const output = await client.run(
      "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
      {
        input: {
          prompt,
          negative_prompt: "low quality, blurry, text, watermark, logo",
          num_outputs: 1,
          scheduler: "K_EULER",
          num_inference_steps: 50,
        }
      }
    );

    if (!Array.isArray(output) || !output[0]) {
      console.error('Invalid response from Replicate:', output);
      throw new Error('Invalid response from Replicate API');
    }

    console.log('Successfully generated image URL:', output[0]);

    // Convert image URL to base64
    const response = await fetch(output[0]);
    if (!response.ok) {
      throw new Error(`Failed to fetch generated image: ${response.statusText}`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to generate AI thumbnail:', error);
    throw error;
  }
}
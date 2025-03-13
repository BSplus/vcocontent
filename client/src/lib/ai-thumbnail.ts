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
    console.log('Starting AI thumbnail generation for:', title);
    const client = initializeReplicate();

    // Create a prompt that captures the essence of the event
    const prompt = `Professional photography style: A dramatic racing event scene for "${title}". ${description}. 
    Photorealistic, high quality, dynamic composition, motion blur, dramatic lighting, race cars in action,
    high-end sports photography look, no text or watermarks.`;

    console.log('Using prompt:', prompt);

    const output = await client.run(
      "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
      {
        input: {
          prompt,
          negative_prompt: "text, watermark, logo, blur, low quality, cartoon style, illustration style",
          num_outputs: 1,
          scheduler: "K_EULER",
          num_inference_steps: 50,
          guidance_scale: 7.5,
          width: 1024,
          height: 576, // 16:9 aspect ratio for event thumbnails
        }
      }
    );

    console.log('Raw Replicate output:', output);

    if (!Array.isArray(output) || !output[0]) {
      console.error('Invalid response from Replicate:', output);
      throw new Error('Invalid response from Replicate API');
    }

    const imageUrl = output[0];
    console.log('Successfully generated image URL:', imageUrl);

    // Convert image URL to base64
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch generated image: ${response.statusText}`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to generate AI thumbnail:', error);
    // Return a default placeholder image URL instead of throwing
    return "/attached_assets/%2389_3.png";
  }
}
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: import.meta.env.VITE_REPLICATE_API_TOKEN,
});

export async function generateEventThumbnail(title: string, description: string): Promise<string> {
  try {
    if (!import.meta.env.VITE_REPLICATE_API_TOKEN) {
      throw new Error('Replicate API token not found');
    }

    // Create a prompt that captures the essence of the event
    const prompt = `A photorealistic racing event scene for "${title}": ${description}. High quality, dramatic lighting, professional sports photography style.`;

    console.log('Generating AI thumbnail with prompt:', prompt);

    const output = await replicate.run(
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
      throw new Error('Invalid response from Replicate API');
    }

    // Convert image URL to base64
    const response = await fetch(output[0]);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to generate AI thumbnail:', error);
    throw new Error('Failed to generate AI thumbnail');
  }
}
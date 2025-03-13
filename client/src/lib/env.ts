
interface EnvVariables {
  REPLICATE_API_TOKEN?: string;
}

const env: EnvVariables = {
  REPLICATE_API_TOKEN: import.meta.env.VITE_REPLICATE_API_TOKEN,
};

export function getEnv(key: keyof EnvVariables): string | undefined {
  return env[key];
}

export function hasReplicateToken(): boolean {
  return !!env.REPLICATE_API_TOKEN;
}

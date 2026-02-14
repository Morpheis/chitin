/**
 * Embedding configuration — resolves provider, model, and API key from
 * explicit options or environment variables.
 */

export interface EmbeddingConfig {
  provider: string;  // 'voyage' | 'openai'
  model: string;     // provider-specific model name
  apiKey: string;    // from env var
}

/** Maps provider name → { envVar, defaultModel } */
const PROVIDER_DEFAULTS: Record<string, { envVar: string; defaultModel: string }> = {
  voyage: {
    envVar: 'VOYAGE_API_KEY',
    defaultModel: 'voyage-3-lite',
  },
  openai: {
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'text-embedding-3-small',
  },
};

const DEFAULT_PROVIDER = 'voyage';

/**
 * Load embedding configuration from explicit options and environment.
 * 
 * @param providerName - Provider name (defaults to 'voyage')
 * @param modelName - Model name (defaults to provider's default model)
 * @returns Resolved EmbeddingConfig
 * @throws Error if API key is not set in environment
 */
export function loadEmbeddingConfig(providerName?: string, modelName?: string): EmbeddingConfig {
  const provider = providerName ?? DEFAULT_PROVIDER;

  const defaults = PROVIDER_DEFAULTS[provider];
  if (!defaults) {
    throw new Error(
      `Unknown embedding provider: '${provider}'. Supported: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`
    );
  }

  const model = modelName ?? defaults.defaultModel;
  const apiKey = process.env[defaults.envVar];

  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}: set ${defaults.envVar} environment variable`
    );
  }

  return { provider, model, apiKey };
}

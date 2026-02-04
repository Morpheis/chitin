/**
 * Load Carapace credentials from the standard config file.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'carapace',
  'credentials.json',
);

export interface CarapaceCredentials {
  apiKey: string;
  agentId: string;
}

export function loadCarapaceConfig(configPath?: string): CarapaceCredentials {
  const filePath = configPath ?? DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Carapace credentials not found at ${filePath}. ` +
      'Register at https://carapaceai.com/api/v1/agents and save credentials.',
    );
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!raw.api_key) {
    throw new Error(
      'Carapace credentials file is missing api_key. ' +
      'Expected: { "api_key": "sc_key_...", "agent_id": "..." }',
    );
  }

  return {
    apiKey: raw.api_key,
    agentId: raw.agent_id ?? '',
  };
}

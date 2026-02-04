import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadCarapaceConfig } from '../../src/carapace/config.js';
import fs from 'node:fs';

vi.mock('node:fs');
const mockedFs = vi.mocked(fs);

describe('loadCarapaceConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads config from default path', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ api_key: 'sc_key_test', agent_id: 'agent-123' }),
    );

    const config = loadCarapaceConfig();

    expect(config.apiKey).toBe('sc_key_test');
    expect(config.agentId).toBe('agent-123');
  });

  it('loads config from custom path', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ api_key: 'sc_key_custom', agent_id: 'agent-456' }),
    );

    const config = loadCarapaceConfig('/custom/path.json');

    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/custom/path.json', 'utf-8');
    expect(config.apiKey).toBe('sc_key_custom');
  });

  it('throws if file not found', () => {
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => loadCarapaceConfig()).toThrow('credentials not found');
  });

  it('throws if api_key is missing', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ agent_id: 'agent-123' }));

    expect(() => loadCarapaceConfig()).toThrow('api_key');
  });
});

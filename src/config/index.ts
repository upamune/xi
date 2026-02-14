export const VERSION = '0.1.0';
export const NAME = 'zi';

export interface Config {
  provider: 'anthropic' | 'openai' | 'kimi';
  model: string;
  thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high';
}

export const DEFAULT_CONFIG: Config = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinking: 'medium',
};

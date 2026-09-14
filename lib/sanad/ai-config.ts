import { groqConfiguration, type GroqEnvironment } from './groq';

export function aiConfiguration(env: GroqEnvironment, externalAllowed: boolean) {
  const keyConfigured = Boolean(env.GROQ_API_KEY?.trim());
  return {
    ...groqConfiguration(externalAllowed ? env : {}),
    keyConfigured,
    externalAllowed,
    status: !keyConfigured ? 'missing_key' as const : externalAllowed ? 'enabled' as const : 'disabled' as const,
  };
}
export type AiConfiguration = ReturnType<typeof aiConfiguration>;

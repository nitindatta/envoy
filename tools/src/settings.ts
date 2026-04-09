import { z } from 'zod';

const SettingsSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().positive().default(4320),
  internalAuthSecret: z.string().min(1),
  chromeDebugPort: z.number().int().positive().default(9222),
  browserProfileDir: z.string().default('../automation/browser-profile'),
  artifactDir: z.string().default('../automation/artifacts'),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(): Settings {
  const secret = process.env.INTERNAL_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'INTERNAL_AUTH_SECRET is required. Set it in your environment before starting the Node tool service.',
    );
  }
  return SettingsSchema.parse({
    host: process.env.NODE_TOOL_HOST,
    port: process.env.NODE_TOOL_PORT ? Number(process.env.NODE_TOOL_PORT) : undefined,
    internalAuthSecret: secret,
    chromeDebugPort: process.env.CHROME_DEBUG_PORT ? Number(process.env.CHROME_DEBUG_PORT) : undefined,
    browserProfileDir: process.env.BROWSER_PROFILE_DIR,
    artifactDir: process.env.ARTIFACT_DIR,
  });
}

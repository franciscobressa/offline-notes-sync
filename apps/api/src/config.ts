export interface AppConfig {
  readonly port: number;
}

/** Reads configuration from environment variables, failing fast on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env['PORT'] ?? 3001);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got "${env['PORT']}"`);
  }
  return { port };
}

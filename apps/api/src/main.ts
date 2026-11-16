import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemorySyncStore } from '@offline-notes-sync/core';
import { AppModule, configureApp } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  // Composition root: the only adapter is in memory (ADR 0009).
  // Another adapter would only need to implement the SyncStore port.
  const app = await NestFactory.create(AppModule.forRoot(new InMemorySyncStore()));
  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(`Sync API on :${config.port} (storage: in memory)`);
}

void bootstrap();

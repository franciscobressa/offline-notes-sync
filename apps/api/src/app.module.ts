import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SyncStore } from '@offline-notes-sync/core';
import { SyncController } from './sync/sync.controller.js';
import { SYNC_STORE } from './sync/tokens.js';

/**
 * Express' default JSON limit is 100kb. A full batch can reach
 * 100 operations × 100,000 characters (ADR 0004, 0008).
 */
export const JSON_BODY_LIMIT = '12mb';

@Module({})
export class AppModule {
  /** The adapter is chosen outside (main.ts or a test) and injected here. */
  static forRoot(store: SyncStore): DynamicModule {
    return {
      module: AppModule,
      controllers: [SyncController],
      providers: [{ provide: SYNC_STORE, useValue: store }],
    };
  }
}

/** HTTP setup shared by main.ts and the e2e tests, so both run the same app. */
export function configureApp(app: INestApplication): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: JSON_BODY_LIMIT });
}

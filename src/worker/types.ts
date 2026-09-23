import type { AuthIdentity } from './auth/password';

export interface SecurityEnvironment {
  DOVARI_PASSWORD?: string;
  CF_VERSION_METADATA?: { id?: string };
}

export type WorkerBindings = CloudflareBindings & SecurityEnvironment;

export interface WorkerVariables {
  identity?: AuthIdentity;
  requestId: string;
}

export type WorkerApp = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};

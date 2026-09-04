import { listProviders, packageCapabilities, version, type ProviderStatus } from "@agntn/web";

export interface ProvidersAnswer {
  version: string;
  /** `listProviders()` as the library reports it on the worker: name, env var, configured flag and the capability matrix. Never a key. */
  providers: ProviderStatus[];
  packageCapabilities: typeof packageCapabilities;
}

/** The provider matrix as the worker sees it; `configured` says whether the worker holds a key, nothing more. */
export default defineEventHandler((event): ProvidersAnswer => {
  markPublic(event, TTL.providers);
  return { version, providers: listProviders(), packageCapabilities };
});

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** Static assets (the built PWA in dist/). */
  ASSETS: Fetcher;
  /** Edge snapshot cache + login rate limiting (+ mock DB in local dev). */
  KV: KVNamespace;
  /** Login password (wrangler secret). */
  APP_PASSWORD: string;
  /** Random string used to sign session cookies (wrangler secret). */
  SESSION_SECRET: string;
  /** Apps Script /exec URL. Empty => use the KV-backed mock backend (local dev / demo only). */
  GAS_URL?: string;
  /** Shared HMAC secret with Apps Script (Script Property HMAC_SECRET). */
  GAS_HMAC_SECRET?: string;
}

/**
 * claude.js
 *
 * Replaces window.claude.complete() from the Claude Artifact runtime.
 *
 * Priority order for the API key:
 *   1. Runtime key set via setApiKey() — stored in sessionStorage for the tab lifetime
 *   2. VITE_ANTHROPIC_API_KEY env var — set at build time (dev/CI use only)
 *
 * For production deployments, use a server-side proxy so the key is never
 * exposed in the browser bundle. See README.md → Deployment → Server Proxy.
 */

const SESSION_KEY = 'cv_anthropic_key';
const MODEL       = 'claude-sonnet-4-20250514';
const API_URL     = 'https://api.anthropic.com/v1/messages';

// ── Key management ────────────────────────────────────────────────────────────

export function getApiKey() {
  return (
    sessionStorage.getItem(SESSION_KEY) ||
    (import.meta.env.VITE_ANTHROPIC_API_KEY ?? '')
  );
}

export function setApiKey(key) {
  sessionStorage.setItem(SESSION_KEY, key.trim());
}

export function clearApiKey() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

// ── Core completion ───────────────────────────────────────────────────────────

/**
 * @param {string} prompt
 * @param {number} [maxTokens=4096]
 * @returns {Promise<string>}
 */
export async function claudeComplete(prompt, maxTokens = 4096) {
  const key = getApiKey();
  if (!key) throw new ApiKeyError('No Anthropic API key configured.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':          key,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
      // Required for direct browser calls — Anthropic allowlists this header
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg  = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new ApiKeyError('Invalid API key. Check your key and try again.');
    throw new Error(`Anthropic API error: ${msg}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ApiKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

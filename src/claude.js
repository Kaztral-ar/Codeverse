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
const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_RETRIES = 2;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

function extractTextContent(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter(block => block?.type === 'text' && typeof block?.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim();
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|javascript|typescript|python|\w+)?\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

async function parseErrorResponse(res) {
  const body = await res.json().catch(() => null);
  const message = body?.error?.message ?? `HTTP ${res.status}`;
  return { body, message };
}

async function callAnthropic({ system, messages, maxTokens = 4096, temperature = 0 }) {
  const key = getApiKey();
  if (!key) throw new ApiKeyError('No Anthropic API key configured.');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          system,
          max_tokens: maxTokens,
          temperature,
          messages,
        }),
      });

      if (!res.ok) {
        const { message } = await parseErrorResponse(res);

        if (res.status === 401) {
          throw new ApiKeyError('Invalid API key. Check your key and try again.');
        }

        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          await sleep(700 * (attempt + 1));
          continue;
        }

        throw new ClaudeApiError(`Anthropic API error: ${message}`, res.status);
      }

      const data = await res.json();
      return extractTextContent(data);
    } catch (error) {
      if (error instanceof ApiKeyError || error instanceof ClaudeApiError) {
        throw error;
      }

      if (error?.name === 'AbortError') {
        throw new ClaudeApiError('Anthropic API request timed out. Please try again.', 408);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(700 * (attempt + 1));
        continue;
      }

      throw new ClaudeApiError('Unable to reach the Anthropic API. Check your connection and try again.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new ClaudeApiError('Anthropic API request failed after multiple attempts.');
}

// ── Core completion ───────────────────────────────────────────────────────────

/**
 * @param {string} prompt
 * @param {number} [maxTokens=4096]
 * @returns {Promise<string>}
 */
export async function claudeComplete(prompt, maxTokens = 4096) {
  return callAnthropic({
    maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
}

export async function claudeConvertCode({ sourceCode, sourceLanguage, targetLanguage }) {
  return stripCodeFence(await callAnthropic({
    temperature: 0,
    system: 'You are an expert code migration assistant. Preserve behavior, avoid explanations, and return only executable code.',
    messages: [{
      role: 'user',
      content:
        `Convert this ${sourceLanguage} code to ${targetLanguage}. ` +
        'Preserve the behavior, keep the output idiomatic, and return only the converted code.\n\n' +
        `<source_code>\n${sourceCode}\n</source_code>`,
    }],
  }));
}

export async function claudeDetectAndConvertCode({ sourceCode, targetLanguage }) {
  const raw = await callAnthropic({
    temperature: 0,
    system: 'You detect programming languages and convert code. Always return valid JSON only.',
    messages: [{
      role: 'user',
      content:
        'Detect the programming language in the source code, then convert it to ' +
        `${targetLanguage}. Respond with JSON using this exact shape: ` +
        '{"detectedLanguage":"<language>","code":"<converted code>"}.\n\n' +
        `<source_code>\n${sourceCode}\n</source_code>`,
    }],
  });

  const cleaned = stripCodeFence(raw);
  const parsed = JSON.parse(cleaned);

  return {
    detectedLanguage: parsed?.detectedLanguage?.trim?.() || '',
    code: typeof parsed?.code === 'string' ? stripCodeFence(parsed.code) : '',
  };
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ApiKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

export class ClaudeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ClaudeApiError';
    this.status = status;
  }
}

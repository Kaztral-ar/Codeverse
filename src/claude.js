const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    sessionKey: 'cv_anthropic_key',
    envKey: 'VITE_ANTHROPIC_API_KEY',
    defaultApiUrl: 'https://api.anthropic.com/v1/messages',
    apiUrlEnv: 'VITE_ANTHROPIC_API_URL',
    model: 'claude-sonnet-4-20250514',
    supportsBrowserKey: true,
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-…',
    helpUrl: 'https://console.anthropic.com/keys',
    helpLabel: 'Get an Anthropic API key',
    version: '2023-06-01',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    sessionKey: 'cv_gemini_key',
    envKey: 'VITE_GEMINI_API_KEY',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    apiUrlEnv: 'VITE_GEMINI_API_URL',
    model: 'gemini-2.0-flash',
    supportsBrowserKey: true,
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIzaSy…',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    helpLabel: 'Create a Gemini API key',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter Free',
    sessionKey: 'cv_openrouter_key',
    envKey: 'VITE_OPENROUTER_API_KEY',
    defaultApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiUrlEnv: 'VITE_OPENROUTER_API_URL',
    model: 'google/gemini-2.0-flash-exp:free',
    supportsBrowserKey: true,
    keyPrefix: 'sk-or-',
    keyPlaceholder: 'sk-or-v1-…',
    helpUrl: 'https://openrouter.ai/keys',
    helpLabel: 'Create an OpenRouter key',
  },
};

const DEFAULT_PROVIDER_ID = 'anthropic';
const ACTIVE_PROVIDER_KEY = 'cv_active_provider';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_RETRIES = 2;

function getProviderConfig(providerId = getActiveProvider()) {
  return PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER_ID];
}

function getEnvValue(key) {
  return (import.meta.env[key] ?? '').trim();
}

export function getProviders() {
  return Object.values(PROVIDERS).map(({ id, label }) => ({ id, label }));
}

export function getActiveProvider() {
  const stored = sessionStorage.getItem(ACTIVE_PROVIDER_KEY);
  return PROVIDERS[stored] ? stored : DEFAULT_PROVIDER_ID;
}

export function setActiveProvider(providerId) {
  if (!PROVIDERS[providerId]) return;
  sessionStorage.setItem(ACTIVE_PROVIDER_KEY, providerId);
}

export function getProviderMeta(providerId = getActiveProvider()) {
  const provider = getProviderConfig(providerId);
  return {
    id: provider.id,
    label: provider.label,
    model: provider.model,
    keyPrefix: provider.keyPrefix,
    keyPlaceholder: provider.keyPlaceholder,
    helpUrl: provider.helpUrl,
    helpLabel: provider.helpLabel,
  };
}

export function getApiKey(providerId = getActiveProvider()) {
  const provider = getProviderConfig(providerId);
  return sessionStorage.getItem(provider.sessionKey) || getEnvValue(provider.envKey);
}

export function setApiKey(key, providerId = getActiveProvider()) {
  const provider = getProviderConfig(providerId);
  sessionStorage.setItem(provider.sessionKey, key.trim());
}

export function clearApiKey(providerId = getActiveProvider()) {
  const provider = getProviderConfig(providerId);
  sessionStorage.removeItem(provider.sessionKey);
}

export function requiresApiKey(providerId = getActiveProvider()) {
  const provider = getProviderConfig(providerId);
  const apiUrl = getEnvValue(provider.apiUrlEnv) || provider.defaultApiUrl;
  return apiUrl === provider.defaultApiUrl && provider.supportsBrowserKey;
}

export function hasApiKey(providerId = getActiveProvider()) {
  return !requiresApiKey(providerId) || Boolean(getApiKey(providerId));
}

function getApiUrl(provider) {
  return getEnvValue(provider.apiUrlEnv) || provider.defaultApiUrl;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|javascript|typescript|python|[\w#+.-]+)?\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

async function parseErrorResponse(res) {
  const body = await res.json().catch(() => null);
  const message = body?.error?.message || body?.message || `HTTP ${res.status}`;
  return { body, message };
}

function extractAnthropicText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim();
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => part?.text || '').join('\n').trim();
}

function extractOpenRouterText(data) {
  return data?.choices?.[0]?.message?.content?.trim?.() || '';
}

async function callProvider({ system, messages, maxTokens = 4096, temperature = 0, providerId = getActiveProvider() }) {
  const provider = getProviderConfig(providerId);
  const apiUrl = getApiUrl(provider);
  const key = getApiKey(providerId);

  if (requiresApiKey(providerId) && !key) {
    throw new ApiKeyError(`No ${provider.label} API key configured.`);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      let res;
      if (provider.id === 'anthropic') {
        res = await fetch(apiUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(requiresApiKey(providerId) ? {
              'x-api-key': key,
              'anthropic-version': provider.version,
              'anthropic-dangerous-direct-browser-access': 'true',
            } : {}),
          },
          body: JSON.stringify({
            model: provider.model,
            system,
            max_tokens: maxTokens,
            temperature,
            messages,
          }),
        });
      } else if (provider.id === 'gemini') {
        const userPrompt = [system, ...messages.map(message => message.content)].filter(Boolean).join('\n\n');
        const requestUrl = requiresApiKey(providerId) ? `${apiUrl}?key=${encodeURIComponent(key)}` : apiUrl;
        res = await fetch(requestUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              responseMimeType: 'text/plain',
            },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          }),
        });
      } else {
        res = await fetch(apiUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(requiresApiKey(providerId) ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model: provider.model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              ...messages,
            ],
          }),
        });
      }

      if (!res.ok) {
        const { message } = await parseErrorResponse(res);
        if (res.status === 401 || res.status === 403) {
          throw new ApiKeyError(`Invalid ${provider.label} API key. Check your key and try again.`);
        }
        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw new ClaudeApiError(`${provider.label} API error: ${message}`, res.status);
      }

      const data = await res.json();
      if (provider.id === 'anthropic') return extractAnthropicText(data);
      if (provider.id === 'gemini') return extractGeminiText(data);
      return extractOpenRouterText(data);
    } catch (error) {
      if (error instanceof ApiKeyError || error instanceof ClaudeApiError) throw error;
      if (error?.name === 'AbortError') {
        throw new ClaudeApiError(`${provider.label} API request timed out. Please try again.`, 408);
      }
      if (attempt < MAX_RETRIES) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw new ClaudeApiError(`Unable to reach the ${provider.label} API. Check your connection and try again.`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new ClaudeApiError('AI API request failed after multiple attempts.');
}

export async function claudeComplete(prompt, maxTokens = 4096, providerId = getActiveProvider()) {
  return callProvider({
    providerId,
    maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
}

export async function claudeConvertCode({ sourceCode, sourceLanguage, targetLanguage, providerId = getActiveProvider() }) {
  return stripCodeFence(await callProvider({
    providerId,
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

export async function claudeDetectAndConvertCode({ sourceCode, targetLanguage, providerId = getActiveProvider() }) {
  const raw = await callProvider({
    providerId,
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

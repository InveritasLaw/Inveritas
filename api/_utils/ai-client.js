'use strict';

const { getProvider, modelFor } = require('./model');

function textFromOpenAI(body) {
  if (typeof body.output_text === 'string') return body.output_text;
  return (body.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text || '').join('');
}

async function requestProvider(provider, { system, prompt, maxTokens, reasoningEffort, modelOverride }) {
  const model = modelOverride || modelFor(provider);
  if (provider === 'openai' && !/^gpt-[a-z0-9.-]+$/.test(model)) throw new Error('OpenAI model override is invalid');
  if (provider === 'anthropic' && !/^claude-[a-z0-9-]+$/.test(model)) throw new Error('Anthropic model override is invalid');
  const configuredTimeout = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '45000', 10);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 5000), 50000)
    : 45000;
  let response;
  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort || process.env.OPENAI_REASONING_EFFORT || 'medium' },
        input: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt }
        ],
        max_output_tokens: maxTokens
      })
    });
  } else {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] })
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `${provider} request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.provider = provider;
    throw error;
  }
  const text = provider === 'openai' ? textFromOpenAI(body) : (body.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('');
  if (!text) throw new Error(`${provider} returned no text output`);
  return { content: [{ type: 'text', text }], model, provider, usage: body.usage || null };
}

async function callModel(options) {
  const primary = getProvider();
  try {
    return await requestProvider(primary, options);
  } catch (primaryError) {
    // Fallback is deliberately opt-in. A configured legacy provider key must
    // not silently route production traffic away from the selected provider.
    const fallback = (process.env.AI_FALLBACK_PROVIDER || '').toLowerCase();
    if (!fallback) throw primaryError;
    if (!['openai', 'anthropic'].includes(fallback) || fallback === primary) {
      console.error('Ignoring invalid AI_FALLBACK_PROVIDER configuration');
      throw primaryError;
    }
    const fallbackConfigured = fallback === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
    const transient = !primaryError.status || primaryError.status === 408 || primaryError.status === 429 || primaryError.status >= 500;
    if (!fallbackConfigured || !transient) throw primaryError;
    console.error(`${primary} model failed; using configured ${fallback} fallback:`, primaryError.message);
    try {
      return await requestProvider(fallback, options);
    } catch (fallbackError) {
      console.error(`${fallback} fallback also failed:`, fallbackError.message);
      primaryError.fallbackProvider = fallback;
      primaryError.fallbackStatus = fallbackError.status || null;
      throw primaryError;
    }
  }
}

module.exports = { callModel, requestProvider, textFromOpenAI };

'use strict';

function getProvider() {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  if (!['openai', 'anthropic'].includes(provider)) throw new Error('AI_PROVIDER is invalid');
  return provider;
}

function modelFor(provider) {
  if (provider === 'openai') {
    const model = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
    if (!/^gpt-[a-z0-9.-]+$/.test(model)) throw new Error('OPENAI_MODEL is invalid');
    return model;
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  if (!/^claude-[a-z0-9-]+$/.test(model) || model === 'claude-sonnet-4-20250514') {
    throw new Error('ANTHROPIC_MODEL is invalid or retired');
  }
  return model;
}

function getModel() { return modelFor(getProvider()); }
function hasAIConfig() {
  return getProvider() === 'openai' ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

module.exports = { getProvider, getModel, modelFor, hasAIConfig };

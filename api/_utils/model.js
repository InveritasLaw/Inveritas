'use strict';

// Provider-recommended replacement, checked September 1, 2026.
// Overrides must be evaluated before release; this is not an availability probe.
function getModel() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  if (!/^claude-[a-z0-9-]+$/.test(model) || model === 'claude-sonnet-4-20250514') {
    throw new Error('ANTHROPIC_MODEL is invalid or retired');
  }
  return model;
}
module.exports = { getModel };

'use strict';

function freePreview(data) {
  const copy = JSON.parse(JSON.stringify(data));
  const block = copy?.content?.find(part => part?.type === 'text' && typeof part.text === 'string');
  if (!block) return { preview_locked: true, upgrade_required: true, content: [] };
  try {
    const full = JSON.parse(block.text.replace(/```json|```/g, '').trim());
    const vectors = Array.isArray(full.inversion_vectors) ? full.inversion_vectors : [];
    const previewVector = vectors[0] ? {
      category: vectors[0].category,
      legal_tier: vectors[0].legal_tier,
      title: vectors[0].title,
      confidence: vectors[0].confidence,
      argument: 'Purchase access to view the complete legal argument, prerequisites, and applicable law.'
    } : null;
    block.text = JSON.stringify({
      charge_analysis: full.charge_analysis || null,
      inversion_vectors: previewVector ? [previewVector] : [],
      vector_count: vectors.length,
      preview_locked: true,
      upgrade_required: true,
      locked_sections: ['jurisdiction_analysis', 'tier_conflict_opportunities', 'evidence_priorities', 'statutory_escape_hatches', 'prosecution_weaknesses', 'recommended_motions', 'critical_deadlines', 'critical_warnings']
    });
  } catch (_) {
    block.text = JSON.stringify({ preview_locked: true, upgrade_required: true, error: 'Preview unavailable; purchase access to view the complete analysis.' });
  }
  copy.preview_locked = true;
  copy.upgrade_required = true;
  return copy;
}

module.exports = { freePreview };

'use strict';

function rpcData(result, label) {
  if (result?.error) {
    const error = new Error(label + ': ' + result.error.message);
    error.code = result.error.message;
    throw error;
  }
  return result?.data;
}

async function reserveAnalysis(sb, userId) {
  const rows = rpcData(await sb.rpc('reserve_analysis', { p_user_id: userId }), 'Unable to reserve analysis');
  const reservation = Array.isArray(rows) ? rows[0] : rows;
  if (!reservation?.reservation_id) throw new Error('Unable to reserve analysis: database returned no reservation');
  return reservation;
}

async function completeAnalysis(sb, userId, reservationId) {
  rpcData(await sb.rpc('complete_analysis', { p_user_id: userId, p_reservation_id: reservationId }), 'Unable to record analysis usage');
}

async function releaseAnalysis(sb, userId, reservationId) {
  if (!reservationId) return;
  rpcData(await sb.rpc('release_analysis', { p_user_id: userId, p_reservation_id: reservationId }), 'Unable to release analysis reservation');
}

function quotaResponse(error) {
  const message = error?.message || '';
  if (message.includes('free_limit_reached')) return { status: 403, body: { error: 'Free analysis used. Subscribe to run more analyses and unlock full results.', upgrade_required: true } };
  if (message.includes('credit_required')) return { status: 403, body: { error: 'Purchase an analysis credit or upgrade to Practitioner.' } };
  if (message.includes('monthly_limit_reached')) return { status: 403, body: { error: 'Monthly analysis limit reached (50/50). Upgrade to Firm for unlimited.' } };
  return { status: 503, body: { error: 'Analysis entitlement could not be verified. Please try again.' } };
}

module.exports = { reserveAnalysis, completeAnalysis, releaseAnalysis, quotaResponse };

'use strict';

// Existing dashboard uploads use exactly user/case/file. Never normalize an
// untrusted path: reject traversal, encoded separators and ambiguous segments.
function isOwnedEvidencePath(value, userId, caseId) {
  if (typeof value !== 'string' || value.length > 500 || /[%\\\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('/');
  return parts.length === 3 && parts[0] === userId && parts[1] === caseId &&
    parts.every(part => part && part !== '.' && part !== '..') &&
    Boolean(userId && caseId);
}
module.exports = { isOwnedEvidencePath };

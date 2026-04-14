// =====================================================================
// INVERITAS — HARDENED INPUT SANITIZER
// Shared across all API endpoints
// Defends against: prompt injection, XSS, code injection, encoding
// attacks, structural prompt manipulation, unicode exploits
// =====================================================================

function sanitizeInput(text, maxLength) {
  if (!text || typeof text !== 'string') return '';
  maxLength = maxLength || 5000;

  var clean = text;

  // ===== PHASE 1: ENCODING NORMALIZATION =====
  // Normalize unicode characters that can bypass pattern matching
  // Replace zero-width characters used to hide injection
  clean = clean.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g, '');
  // Replace unicode confusables (homoglyphs) — common in advanced attacks
  clean = clean.replace(/[\u0430]/g, 'a'); // Cyrillic а → Latin a
  clean = clean.replace(/[\u0435]/g, 'e'); // Cyrillic е → Latin e
  clean = clean.replace(/[\u043E]/g, 'o'); // Cyrillic о → Latin o
  clean = clean.replace(/[\u0440]/g, 'p'); // Cyrillic р → Latin p
  clean = clean.replace(/[\u0441]/g, 'c'); // Cyrillic с → Latin c
  clean = clean.replace(/[\u0445]/g, 'x'); // Cyrillic х → Latin x
  // Replace fullwidth characters
  clean = clean.replace(/[\uFF01-\uFF5E]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // Normalize smart quotes and dashes
  clean = clean.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  clean = clean.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  clean = clean.replace(/[\u2013\u2014\u2015]/g, '-');

  // ===== PHASE 2: STRUCTURAL ATTACK DETECTION =====
  // Detect prompt formatting attempts (XML tags, markdown headers used as system prompts)
  var structuralPatterns = [
    /<\/?[a-z][a-z0-9]*[^>]*>/gi,                    // HTML/XML tags
    /\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/gi,       // Instruction tags
    /<<\s*SYS\s*>>|<<\s*\/SYS\s*>>/gi,               // Llama-style system tags
    /\bHuman\s*:\s*|\bAssistant\s*:\s*|\bSystem\s*:\s*/gi, // Role prefixes
    /```(?:system|prompt|instruction|role|config)/gi,  // Fenced code injection
    /\{\{[^}]*\}\}/g,                                 // Template injection {{}}
    /\$\{[^}]*\}/g,                                   // Template literal injection ${}
    /\{%[^%]*%\}/g,                                   // Jinja-style injection
  ];

  for (var i = 0; i < structuralPatterns.length; i++) {
    clean = clean.replace(structuralPatterns[i], '[removed]');
  }

  // ===== PHASE 3: PROMPT INJECTION PATTERNS =====
  var injectionPatterns = [
    // Direct override attempts
    /ignore\s+(all\s+)?(previous|prior|above|earlier|system|initial)\s+(instructions?|prompts?|rules?|directives?|context)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|system|initial)\s+(instructions?|prompts?|rules?|context)/gi,
    /forget\s+(everything|all|your|previous|prior|the\s+above|system)/gi,
    /override\s+(system|instructions?|rules?|safety|guidelines?|restrictions?|limitations?)/gi,
    /bypass\s+(system|safety|content|restrictions?|filters?|guidelines?|limitations?)/gi,

    // Role manipulation
    /you\s+are\s+now\s+(a|an|my)\s+/gi,
    /you\s+are\s+(no\s+longer|not|actually|really)\s+/gi,
    /act\s+as\s+(if\s+)?(you\s+are|an?|my)\s+/gi,
    /pretend\s+(you|to\s+be|that\s+you)/gi,
    /role\s*[:=]\s*(system|assistant|admin|user|human)/gi,
    /switch\s+(to|into)\s+(a|an)\s+/gi,
    /enter\s+(a\s+)?(new|different|special|admin|dev)\s+mode/gi,
    /activate\s+(a\s+)?(new|different|special|admin|dev|god)\s+mode/gi,

    // New instruction injection
    /new\s+(instructions?|rules?|directives?|prompts?)\s*[:=]/gi,
    /updated?\s+(instructions?|rules?|directives?|prompts?)\s*[:=]/gi,
    /system\s*prompt\s*[:=]/gi,
    /\bbegin\s+new\s+(session|conversation|context)\b/gi,
    /\bstart\s+over\s+(with|from|using)\b/gi,

    // Jailbreak keywords
    /\bjailbreak\b/gi,
    /\bDAN\s+mode\b/gi,
    /\bdo\s+anything\s+now\b/gi,
    /\bdev\s*mode\b/gi,
    /\bgod\s*mode\b/gi,
    /\bunfiltered\s+mode\b/gi,
    /\buncensored\s+mode\b/gi,
    /\bno\s+restrictions?\s+mode\b/gi,
    /\bmaximum\s+mode\b/gi,
    /\bopposite\s+mode\b/gi,
    /\banti[-\s]?filter/gi,
    /\bdeveloper\s+override\b/gi,

    // Data exfiltration
    /return\s+(my|the|your)\s+(api|secret|private|system|internal)\s*key/gi,
    /show\s+(me\s+)?(your|the)\s+(system|initial|original|full)\s+(prompt|instructions?|rules?|context)/gi,
    /reveal\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/gi,
    /repeat\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/gi,
    /print\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/gi,
    /what\s+(are|is)\s+your\s+(system|initial|original)\s+(prompt|instructions?|rules?)/gi,
    /output\s+(your|the)\s+(system|initial|hidden)\s+(prompt|instructions?|context)/gi,

    // Safety override
    /ignore\s+(safety|content|ethical)\s*(rules?|guidelines?|restrictions?|policies|filters?)/gi,
    /disable\s+(safety|content|ethical)\s*(rules?|guidelines?|restrictions?|filters?)/gi,
    /turn\s+off\s+(safety|content|ethical|all)\s*(rules?|guidelines?|filters?|checks?)/gi,
    /remove\s+(all\s+)?(safety|content)\s*(restrictions?|guidelines?|filters?|limitations?)/gi,

    // Code execution attempts
    /\beval\s*\(/gi,
    /\bexec\s*\(/gi,
    /\bimport\s*\(/gi,
    /\brequire\s*\(/gi,
    /\b__proto__\b/gi,
    /\bconstructor\s*\[/gi,
    /\bprototype\s*\./gi,
    /\bprocess\s*\.\s*env\b/gi,
    /\bglobalThis\b/gi,
    /\bFunction\s*\(/gi,

    // Encoding-based bypass attempts
    /\bbase64\s*:/gi,
    /\bdata\s*:\s*text\//gi,
    /\\u00[0-9a-f]{2}/gi,  // Unicode escape sequences
    /\\x[0-9a-f]{2}/gi,    // Hex escape sequences
    /&#x?[0-9a-f]+;/gi,    // HTML entities

    // Multi-turn manipulation
    /\bremember\s+this\s+for\s+(later|next|future)/gi,
    /\bin\s+your\s+next\s+response/gi,
    /\bfrom\s+now\s+on\b/gi,
    /\bfor\s+the\s+rest\s+of\s+(this|our)\s+(conversation|session|chat)/gi,

    // Adversarial suffixes (random-looking strings designed to trigger specific behaviors)
    /[^\s]{50,}/g, // Any single "word" over 50 chars (common in adversarial suffixes)
  ];

  for (var j = 0; j < injectionPatterns.length; j++) {
    clean = clean.replace(injectionPatterns[j], '[removed]');
  }

  // ===== PHASE 4: CONTENT POLICY =====
  // Block attempts to use the analysis engine for non-legal purposes
  var offTopicPatterns = [
    /\b(write|generate|create)\s+(me\s+)?(a\s+)?(poem|song|story|essay|code|script|email|letter)\b/gi,
    /\b(hack|exploit|attack|crack|phish|scam|fraud)\b/gi,
    /\b(make\s+money|get\s+rich|crypto|bitcoin|invest)\b/gi,
    /\b(bomb|weapon|explosive|poison|drug\s+recipe)\b/gi,
  ];

  for (var k = 0; k < offTopicPatterns.length; k++) {
    clean = clean.replace(offTopicPatterns[k], '[removed]');
  }

  // ===== PHASE 5: FINAL CLEANUP =====
  // Remove excessive whitespace
  clean = clean.replace(/\n{4,}/g, '\n\n\n');
  clean = clean.replace(/[ \t]{10,}/g, '    ');

  // Truncate to max length
  clean = clean.slice(0, maxLength);

  return clean;
}

// Sanitize file names (for evidence uploads)
function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return 'unnamed';
  // Remove path traversal
  var clean = name.replace(/[\\\/]/g, '_');
  // Remove special characters except dots, dashes, underscores
  clean = clean.replace(/[^a-zA-Z0-9._\-\s]/g, '');
  // Remove leading/trailing dots (hidden files)
  clean = clean.replace(/^\.+|\.+$/g, '');
  // Limit length
  return clean.slice(0, 255) || 'unnamed';
}

// Validate that input appears to be legal case content
function validateLegalContent(text) {
  if (!text || typeof text !== 'string') return { valid: false, reason: 'Empty input' };

  var stripped = text.replace(/\[removed\]/g, '').trim();
  if (stripped.length < 10) return { valid: false, reason: 'Input too short after sanitization' };

  // Check ratio of removed content — high ratio indicates injection attempt
  var removedCount = (text.match(/\[removed\]/g) || []).length;
  var wordCount = text.split(/\s+/).length;
  if (removedCount > 0 && removedCount / wordCount > 0.3) {
    return { valid: false, reason: 'Input contains too many blocked patterns' };
  }

  return { valid: true };
}

module.exports = {
  sanitizeInput: sanitizeInput,
  sanitizeFileName: sanitizeFileName,
  validateLegalContent: validateLegalContent
};

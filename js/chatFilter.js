// autofilter-fixed-headshot-updated.js
// Conservative deobfuscation + fuzzy filter
// Minimal, safe-by-default changes to preserve normal words while catching common obfuscations.

import AhoCorasick from "https://cdn.jsdelivr.net/npm/modern-ahocorasick@2.0.4/dist/index.js";
import leoProfanity from "https://esm.sh/leo-profanity@1.8.0";
import { bannedWords } from "./bannedWords.js";

// ---------- helpers ----------
const LEET_MAP = { '0':'o','1':'l','2':'z','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','9':'g',
  '@':'a','$':'s','!':'i','+':'t','%':'o','#':'h' };

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function normalizeSmartPunctuation(s){
  if(!s) return s;
  return String(s)
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g,"'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g,'"')
    .replace(/[\u2013\u2014]/g,'-')
    .replace(/\u2026/g,'...')
    .replace(/\u00A0/g,' ');
}

// ---------- Swal on-top helpers (so SweetAlert2 appears above everything) ----------
const SWAL_ON_TOP_STYLE_ID = 'swal-on-top-style';
function ensureSwalOnTopStyle(){
  if (typeof document === 'undefined' || !document.getElementById) return;
  if (document.getElementById(SWAL_ON_TOP_STYLE_ID)) return;
  try {
    const style = document.createElement('style');
    style.id = SWAL_ON_TOP_STYLE_ID;
    style.textContent = `
      .swal2-container{position:fixed!important;z-index:2147483646!important;top:0;left:0;right:0;bottom:0;}
      .swal2-backdrop-show{z-index:2147483645!important;}
      .swal2-popup{position:fixed!important;z-index:2147483647!important;}
    `;
    document.head && document.head.appendChild(style);
  } catch (e) {
    // fail silently; not critical
    console.warn('ensureSwalOnTopStyle failed', e);
  }
}

function showSwal(opts = {}){
  ensureSwalOnTopStyle();
  try {
    if (typeof Swal !== 'undefined' && Swal && typeof Swal.fire === 'function') {
      const wrapped = Object.assign({}, opts, {
        willOpen: popup => { try{ if (typeof opts.willOpen === 'function') opts.willOpen(popup); }catch(e){} },
        didOpen: popup => { try{ if (typeof opts.didOpen === 'function') opts.didOpen(popup); }catch(e){} }
      });
      return Swal.fire(wrapped).catch(()=>{});
    }
  } catch (e) {
    console.warn('showSwal error', e);
  }
  return Promise.resolve();
}

function blockedPopup(customText){
  try{
    const text = customText || 'Your message was blocked by the autofilter. Please review your message for inappropriate content.';
    showSwal({
      icon: 'error',
      title: 'Message Blocked',
      text,
      confirmButtonText: 'OK'
    });
  }catch(e){
    try {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Message Blocked: ' + (customText || 'Your message was blocked by the autofilter.'));
      }
    } catch (e2) {
      console.warn('blockedPopup fallback failed', e2);
    }
  }
  return false;
}

// Conservative substitution set (multi-char first, safe defaults; single-letter rules are gated)
const SUBSTITUTIONS = [
  // Multi-char / digraphs (safe-ish)
  ['tion', 'shun'],
  ['sion', 'shun'],
  ['ture', 'chur'],
  ['tch', 'ch'],
  ['cc', 'k'],
  ['ck', 'k'],
  ['ph', 'f'],
  ['qu', 'kw'],
  ['wh', 'w'],
  ['ch', 'sh'],
  ['sh', 'sh'], // no-op to ensure order
  ['igh', 'i'],
  // endings
  ['e$', ''],
  // doubled-letter simplifications
  ['ll','l'], ['ss','s'], ['ff','f'], ['pp','p'], ['rr','r'], ['tt','t'], ['mm','m'], ['nn','n']
];

// Single-letter substitutions (AGGRESSIVE) - apply only when token looks obfuscated
const SINGLE_LETTER_SUBS = [
  ['c','k'],
  ['x','ks'],
  ['q','k'],
  ['v','f'],
  ['z','s'],
  // note: we purposely avoid vowel swaps and many other aggressive mappings
];

function looksObfuscated(word) {
  if(!word) return false;
  if (/[0-9]/.test(word)) return true;
  if (/[^a-z]/.test(word)) return true; // contains punctuation/other
  if (/(.)\1{2,}/.test(word)) return true; // eeee
  return false;
}

function compileSubs(list) {
  // sort by pattern length desc so long patterns (e.g. "tion") run before "ti"
  const sorted = list.slice().sort((a,b) => b[0].length - a[0].length);
  return sorted.map(([from,to]) => {
    const isRegexLike = /[\\^$.*+?()[\\]{}|]/.test(from);
    const re = isRegexLike ? new RegExp(from, 'g') : new RegExp(escapeRegex(from), 'g');
    return { from, to, re, isRegexLike };
  });
}

const COMPILED_SUBS = compileSubs(SUBSTITUTIONS);
const COMPILED_SINGLE = compileSubs(SINGLE_LETTER_SUBS);

// deobfuscate: conservative behavior by default; set aggressive=true to apply single-letter subs to all words
function deobfuscate(text, { aggressive = false } = {}){
  if(!text) return '';
  let s = String(text).toLowerCase();

  // 1) leet map first
  s = s.split('').map(ch => LEET_MAP[ch] ?? ch).join('');

  // 2) split into words & preserve separators
  const parts = s.split(/(\s+)/);

  for (let i = 0; i < parts.length; i++){
    if (/^\s+$/.test(parts[i])) continue;
    let w = parts[i];

    // apply multi-char subs unconditionally
    for (const sub of COMPILED_SUBS) {
      w = w.replace(sub.re, sub.to);
    }

    // apply single-letter subs only on obfuscated-looking words or if aggressive
    if (aggressive || looksObfuscated(w)) {
      for (const sub of COMPILED_SINGLE) {
        w = w.replace(sub.re, sub.to);
      }
    }

    // mild repeated-letter collapse: 3+ -> 2 to preserve normal doubles
    w = w.replace(/(.)\1{2,}/g, '$1$1');

    // normalize accents
    try{ w = w.normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }catch(e){}

    // turn non-alphanum into space (trim later)
    w = w.replace(/[^a-z0-9]+/g,' ').trim();

    parts[i] = w;
  }

  return parts.join('').replace(/\s+/g,' ').trim();
}

// ---------- Damerau distance (same logic as your JS implementation) ----------
function damerauDistance(a,b,maxDist=Infinity){
  if(a===b) return 0;
  const la=a.length, lb=b.length;
  if(Math.abs(la-lb) > maxDist) return maxDist+1;
  if(la===0) return lb;
  if(lb===0) return la;
  const INF = la+lb, da = {};
  const score = Array(la+2).fill(null).map(()=>Array(lb+2).fill(0));
  score[0][0] = INF;
  for(let i=0;i<=la;i++){ score[i+1][1]=i; score[i+1][0]=INF; }
  for(let j=0;j<=lb;j++){ score[1][j+1]=j; score[0][j+1]=INF; }
  for(let i=1;i<=la;i++){
    let db=0;
    for(let j=1;j<=lb;j++){
      const i1 = da[b[j-1]] ?? 0;
      const j1 = db;
      let cost = 1;
      if(a[i-1]===b[j-1]){ cost=0; db=j; }
      score[i+1][j+1] = Math.min(
        score[i][j] + cost,
        score[i+1][j] + 1,
        score[i][j+1] + 1,
        score[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1)
      );
    }
    da[a[i-1]] = i;
    if (Math.min(...score[i+1].slice(1, lb+2)) > maxDist) return maxDist+1;
  }
  return score[la+1][lb+1];
}

// ---------- prepare keywords ----------
const rawKeywords = Array.isArray(bannedWords) ? bannedWords : [];
const normalizedKeywords = rawKeywords.map(k => typeof k === 'string' ? deobfuscate(k, { aggressive: true }) : '').filter(Boolean);
const keywordMeta = normalizedKeywords.map(k => ({ token: k, len: k.length }));

function allowedDistanceForLen(len){
  if(len <= 3) return 0;
  if(len <= 6) return 1;
  return 1;
}

// ---------- main diagnosis (keeps your previous flow, but uses conservative deobfuscate) ----------
export function diagnoseMessage(text){
  if (typeof text !== 'string') return { blocked: true, reason: 'not-string' };
  if (text.length === 1) return { blocked: false };

  const normalizedInput = normalizeSmartPunctuation(text);

  // allowed-chars
  // NOTE: this pattern includes emoji-ish and a wide character set; adjust if your environment doesn't support \p{Emoji}
  try {
    const allowedCharsPattern = /^[a-zA-Z0-9 `~!@#$%^&*()\-_=+\[\]{}|;:'",.<>\/?\\\p{Emoji}\s]*$/u;
    if (!allowedCharsPattern.test(normalizedInput)) return { blocked: true, reason: 'unsupported-characters' };
  } catch (e) {
    // fallback for environments that don't support \p{Emoji} in regex
    const fallbackAllowed = /^[a-zA-Z0-9 `~!@#$%^&*()\-_=+\[\]{}|;:'",.<>\/?\\\s]*$/u;
    if (!fallbackAllowed.test(normalizedInput)) return { blocked: true, reason: 'unsupported-characters' };
  }

  // deobfuscate per our conservative rules
  const norm = deobfuscate(normalizedInput);

  // leo-profanity word-level check (deobfuscated words)
  try {
    if (leoProfanity && typeof leoProfanity.check === 'function') {
      const lpWords = norm.split(/\s+/).filter(Boolean);
      for (const w of lpWords) {
        try {
          if (leoProfanity.check(w)) {
            return { blocked: true, reason: 'leo-profanity', token: w };
          }
        } catch (e) { /* ignore per-word errors */ }
      }
    }
  } catch (e) {}

  // EXACT whole-word checks using normalizedKeywords
  try {
    for (const token of normalizedKeywords) {
      if (!token) continue;
      const re = new RegExp(`\\b${escapeRegex(token)}\\b`, 'iu');
      if (re.test(norm)) return { blocked: true, reason: 'exact', token, substring: token };
    }
  } catch (e) {
    console.warn('Exact regex check failed', e);
  }

  // FUZZY PASS (word-aware, conservative)
  const words = norm.split(/\s+/).filter(Boolean);
  const FUZZY_ALLOWLIST = new Set(['shot','headshot','headshots','platform','proof','ambition','persistence']);

  for (const { token, len } of keywordMeta) {
    if (!token) continue;
    const allowed = allowedDistanceForLen(len);
    if (allowed === 0) continue;
    const minLen = Math.max(1, len - allowed);
    const maxLen = len + allowed;
    for (const w of words) {
      if (w.length < minLen) continue;
      const endLimit = w.length - minLen;
      for (let i = 0; i <= endLimit; i++) {
        for (let L = minLen; L <= maxLen; L++) {
          if (i + L > w.length) break;
          const sub = w.substring(i, i + L);
          if (FUZZY_ALLOWLIST.has(sub)) continue;
          if (!(i === 0 || i + L === w.length)) continue;
          if (token[0] !== sub[0] || token[token.length-1] !== sub[sub.length-1]) continue;
          const dist = damerauDistance(token, sub, allowed);
          if (dist <= allowed) return { blocked: true, reason: 'fuzzy', token, substring: sub, distance: dist };
        }
      }
    }
  }

  return { blocked: false };
}

/* ------------------------ New: masking / sanitization helpers ------------------------
   Goal: when something is filtered, replace offending parts with asterisks instead of
   simply blocking. We provide:
     - sanitizeMessage(text): returns a string with masked parts
     - filterOrMaskMessage(text): returns { allowed, text, reason } where text is sanitized
   Note: mapping deobfuscated detection back to exact original characters is imperfect.
   We mask the exact matched token/substring (case-insensitive) in the original string,
   and also do a final pass over raw bannedWords for simple exact matches in the original.
   ------------------------------------------------------------------------------- */

function makeAsterisks(len){
  return '*'.repeat(Math.max(1, len));
}

// replace all occurrences of `pattern` (string) in `input` case-insensitively with asterisks of same length
function maskInsensitive(input, pattern){
  if (!pattern || !input) return input;
  try {
    const re = new RegExp(escapeRegex(pattern), 'ig');
    return input.replace(re, (m) => makeAsterisks(m.length));
  } catch (e) {
    // fallback: simple index-based replace (case-sensitive)
    return input.split(pattern).join(makeAsterisks(pattern.length));
  }
}

// A best-effort sanitizer that uses diagnoseMessage output plus rawKeywords
export function sanitizeMessage(text){
  if (typeof text !== 'string' || text.length === 0) return text;

  const normalizedInput = normalizeSmartPunctuation(text);
  let sanitized = String(text);

  // Run diagnosis to discover a single top match (if any)
  let diag = null;
  try {
    diag = diagnoseMessage(text);
  } catch (e) {
    diag = null;
  }

  if (diag && diag.blocked) {
    // Prefer token or substring if available
    if (diag.substring) {
      sanitized = maskInsensitive(sanitized, diag.substring);
    }
    if (diag.token) {
      sanitized = maskInsensitive(sanitized, diag.token);
    }
    // If reason indicates leo-profanity and we have a token, mask it
    if (diag.reason === 'leo-profanity' && diag.token) {
      sanitized = maskInsensitive(sanitized, diag.token);
    }
  }

  // Additional pass: try to mask any raw bannedWords occurrences exactly (case-insensitive)
  try {
    for (const raw of rawKeywords) {
      if (!raw || typeof raw !== 'string') continue;
      // do a simple whole-word-ish replacement to avoid partial collisions:
      // pattern: word boundaries around escaped raw. If raw contains spaces, just plain replace.
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        const wordy = /^\w+$/.test(trimmed);
        if (wordy) {
          const re = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, 'ig');
          sanitized = sanitized.replace(re, (m) => makeAsterisks(m.length));
        } else {
          // contains non-word characters or spaces; use simple insenstive replace
          sanitized = maskInsensitive(sanitized, trimmed);
        }
      } catch (e) {
        sanitized = maskInsensitive(sanitized, trimmed);
      }
    }
  } catch (e) {
    // ignore errors in this best-effort pass
  }

  // Final pass: sanitize any remaining words that leoProfanity flags in the deobfuscated form
  try {
    if (leoProfanity && typeof leoProfanity.check === 'function') {
      const norm = deobfuscate(normalizedInput);
      const words = norm.split(/\s+/).filter(Boolean);
      for (const w of words) {
        try {
          if (leoProfanity.check(w)) {
            sanitized = maskInsensitive(sanitized, w);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return sanitized;
}

/**
 * filterOrMaskMessage(text)
 * - returns { allowed, text, reason }
 *   allowed: boolean -> true if result is considered safe (we return true unless unsupported-characters)
 *   text: sanitized text (with any found matches replaced with asterisks)
 *   reason: diagnosis reason (if any)
 *
 * Important: callers should use the returned `text` for sending/displaying the message.
 */
export function filterOrMaskMessage(text){
  const diag = diagnoseMessage(text);
  if (!diag || !diag.blocked) {
    return { allowed: true, text, reason: null };
  }

  // If reason is unsupported-characters, preserve original behavior (blocking) because input contains disallowed characters
  if (diag.reason === 'unsupported-characters') {
    // keep old UX: show popup and return not-allowed with original text (caller should not send)
    try {
      if (diag.token) {
        blockedPopup(`Your message was blocked by the autofilter (matched "${diag.token}"). Please review your message.`);
      } else {
        blockedPopup();
      }
    } catch (e) { /* ignore */ }
    return { allowed: false, text, reason: diag.reason };
  }

  // Otherwise, mask offending parts and allow sending the sanitized text
  const sanitized = sanitizeMessage(text);

  // Optionally show a gentle notification — change to your preference (silent by default)
  try {
    // silent by default; uncomment the next line if you want a notification each time something is masked:
    // showSwal({ icon: 'info', title: 'Message sanitized', text: 'Potentially inappropriate words were replaced with asterisks.' });
  } catch (e) {}

  return { allowed: true, text: sanitized, reason: diag.reason || null };
}

export function isMessageClean(text){
  const res = diagnoseMessage(text);
  if (res.blocked) {
    // Keep legacy behaviour (blocked popup) for the strict blocking path — but we do not prevent you from using the masking API above.
    try {
      // Prefer to show token-specific info when available
      if (res.token) {
        blockedPopup(`Your message was blocked by the autofilter (matched "${res.token}"). Please review your message.`);
      } else {
        blockedPopup();
      }
    } catch (e) {
      // ensure we still return false even if UI fails
      console.warn('blocked popup failed', e);
    }
    return false;
  }
  return true;
}

// attach for debugging
try {
  if (typeof window !== 'undefined') {
    window.diagnoseMessage = diagnoseMessage;
    window.isMessageClean = isMessageClean;
    window.sanitizeMessage = sanitizeMessage;
    window.filterOrMaskMessage = filterOrMaskMessage;
  }
} catch (e) {}

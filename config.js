'use strict';
// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const CFG = {
  BINANCE_FAPI: 'https://fapi.binance.com/fapi/v1',
  BINANCE_SPOT: 'https://api.binance.com/api/v3',
  BYBIT_API:    'https://api.bybit.com/v5/market',
  GECKO_API:    'https://api.coingecko.com/api/v3',
  TIMEOUT:      12000,
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let _lastChartState = null;
let _lastTicker     = '';
let _lastTF         = '';
let _lastTradeData  = null;
let _autoOn         = false;
let _autoTimer      = null;

// ── DATA CACHE (TTL: 45s per symbol) ──────────────────────────
const _cache = {};
const CACHE_TTL = 45_000;
function cacheGet(key) {
  const e = _cache[key];
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { delete _cache[key]; return null; }
  return e.data;
}
function cacheSet(key, data) { _cache[key] = { data, ts: Date.now() }; }

// ═══════════════════════════════════════════════════════════════
// NAMESPACE LAYER — DECISION | UI
// ═══════════════════════════════════════════════════════════════

const ENGINE = {}; // kept as empty stub

// ── DECISION namespace: validation + rejection logic ──
const DECISION = {
  checkBiasConflict(bias, struct) {
    if (bias === 'bullish' && struct.recentBOS_down)
      return { valid: false, reason: 'BULL_BIAS_BEAR_BOS', penalty: 0 };
    if (bias === 'bearish' && struct.recentBOS_up)
      return { valid: false, reason: 'BEAR_BIAS_BULL_BOS', penalty: 0 };
    return { valid: true, reason: 'OK', penalty: 1.0 };
  },

  checkEntryExtreme(entryQuality, bias, marketState) {
    const eq = (entryQuality || '').toUpperCase();
    if (eq === 'LATE' && marketState === 'EXPANSION')
      return { valid: false, reason: 'LATE_IN_EXPANSION', penalty: 0 };
    if (eq === 'LATE')
      return { valid: true,  reason: 'LATE_ENTRY_PENALTY', penalty: 0.70 };
    return { valid: true, reason: 'OK', penalty: 1.0 };
  },

  checkCompression(structEvents, liqData, compressionScore) {
    const noStruct  = !structEvents || structEvents.length === 0;
    const noSweep   = !liqData || !liqData.sweepDetected;
    const highComp  = compressionScore > 50;
    if (noStruct && noSweep && !highComp)
      return { valid: false, reason: 'NO_STRUCTURE_NO_LIQUIDITY', penalty: 0 };
    if (noStruct && noSweep && highComp)
      return { valid: true,  reason: 'COMPRESSION_ONLY', penalty: 0.80 };
    return { valid: true, reason: 'OK', penalty: 1.0 };
  },

  validate(bias, struct, entryQuality, marketState, liqData, structEvents, compressionScore) {
    const rules = [
      this.checkBiasConflict(bias, struct),
      this.checkEntryExtreme(entryQuality, bias, marketState),
      this.checkCompression(structEvents, liqData, compressionScore),
    ];
    const failed = rules.find(r => !r.valid);
    if (failed) return { valid: false, reason: failed.reason, penalty: 0, rules };
    const minPenalty = Math.min(...rules.map(r => r.penalty));
    return { valid: true, reason: 'SETUP_VALID', penalty: minPenalty, rules };
  },
};

// ── UI namespace: display helpers that read data, never produce it ──
const UI = {
  confidenceColor(score) {
    return score > 75 ? 'var(--green)' : score >= 55 ? 'var(--gold)' : 'var(--red)';
  },
  confidenceLabel(score) {
    return score > 75 ? 'High' : score >= 55 ? 'Medium' : 'Low';
  },
  biasClass(bias) {
    return bias.includes('bull') ? 'bullish' : bias.includes('bear') ? 'bearish' : 'neutral';
  },
  reasonBadgeColor(reasonCode) {
    const map = {
      VALID_SETUP: 'var(--green)', SWEEP_NO_BOS: 'var(--gold)',
      INDUCEMENT_ONLY: 'var(--blue)', STRUCTURE_NO_LIQUIDITY: 'var(--muted)',
      NO_STRUCTURE: 'var(--muted)', BULL_BIAS_BEAR_BOS: 'var(--red)',
      BEAR_BIAS_BULL_BOS: 'var(--red)', LATE_IN_EXPANSION: 'var(--red)',
      LATE_ENTRY_PENALTY: 'var(--gold)', COMPRESSION_ONLY: 'var(--gold)',
    };
    return map[reasonCode] || 'var(--muted)';
  },
};

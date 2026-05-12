/**
 * xp-calculator.js
 * Pure XP math for PF2e encounter building.
 * No Foundry dependencies — all functions take plain values and return plain values.
 * Source: GM Core, Encounter Budget rules.
 */

// ---------------------------------------------------------------------------
// XP cost of a single creature by level difference to party
// Level difference = creature level - party level
// Range: -4 to +4. Anything outside is flagged as impractical.
// ---------------------------------------------------------------------------

const CREATURE_XP_BY_LEVEL_DIFF = {
  "-4": 10,
  "-3": 15,
  "-2": 20,
  "-1": 30,
   "0": 40,
   "1": 60,
   "2": 80,
   "3": 120,
   "4": 160,
};

/**
 * Returns the XP cost for a creature given its effective level and the party level.
 * Elite/Weak adjustments should be applied to creatureLevel before calling.
 *
 * @param {number} creatureLevel  - Effective level of the creature (after Elite/Weak)
 * @param {number} partyLevel     - The active party level
 * @returns {{ xp: number, diff: number, outOfRange: boolean }}
 */
export function getCreatureXP(creatureLevel, partyLevel) {
  const diff = creatureLevel - partyLevel;
  const clampedDiff = Math.max(-4, Math.min(4, diff));
  const xp = CREATURE_XP_BY_LEVEL_DIFF[String(clampedDiff)] ?? 0;

  return {
    xp,
    diff,
    outOfRange: diff < -4 || diff > 4,
  };
}

// ---------------------------------------------------------------------------
// Hazard XP rules (GM Core p.76)
// Simple hazard  → XP as a creature of its listed level
// Complex hazard → XP as a creature 4 levels HIGHER than its listed level
// ---------------------------------------------------------------------------

/**
 * Returns the XP cost for a hazard.
 *
 * @param {number}  hazardLevel - Listed level of the hazard
 * @param {boolean} isComplex   - True if complex (has its own initiative)
 * @param {number}  partyLevel  - The active party level
 * @returns {{ xp: number, effectiveLevel: number, diff: number, outOfRange: boolean }}
 */
export function getHazardXP(hazardLevel, isComplex, partyLevel) {
  const effectiveLevel = isComplex ? hazardLevel + 4 : hazardLevel;
  const result = getCreatureXP(effectiveLevel, partyLevel);
  return { ...result, effectiveLevel };
}

// ---------------------------------------------------------------------------
// Elite / Weak level adjustments
// Elite: +1 to effective level
// Weak:  -1 to effective level
// ---------------------------------------------------------------------------

/**
 * Applies an Elite or Weak adjustment to a base level.
 *
 * @param {number} baseLevel
 * @param {'none'|'elite'|'weak'} adjustment
 * @returns {number} effectiveLevel
 */
export function applyAdjustment(baseLevel, adjustment) {
  if (adjustment === "elite") return baseLevel + 1;
  if (adjustment === "weak")  return baseLevel - 1;
  return baseLevel;
}

// ---------------------------------------------------------------------------
// XP budget thresholds by difficulty tier (base: 4 players)
// Source: GM Core, Table 10-1: Encounter Budget
// ---------------------------------------------------------------------------

const BUDGET_BASE = {
  trivial:  40,
  low:      60,
  moderate: 80,
  severe:   120,
  extreme:  160,
};

// Per-character XP adjustment when party size differs from 4
const BUDGET_PER_PLAYER_ADJUSTMENT = {
  trivial:  10,
  low:      15,
  moderate: 20,
  severe:   30,
  extreme:  40,
};

/**
 * Returns the XP budgets for all five difficulty tiers given a party size.
 *
 * @param {number} partySize - Number of player characters
 * @returns {{ trivial: number, low: number, moderate: number, severe: number, extreme: number }}
 */
export function getBudgets(partySize) {
  const delta = partySize - 4;

  return Object.fromEntries(
    Object.entries(BUDGET_BASE).map(([tier, base]) => {
      const adjusted = base + delta * BUDGET_PER_PLAYER_ADJUSTMENT[tier];
      return [tier, Math.max(0, adjusted)];
    })
  );
}

// ---------------------------------------------------------------------------
// Difficulty rating — given a total XP and budgets, which tier are we in?
// ---------------------------------------------------------------------------

/**
 * Returns the encounter difficulty tier for a given XP total and party size.
 *
 * @param {number} totalXP
 * @param {number} partySize
 * @returns {{ tier: string, label: string, color: string }}
 */
export function getDifficulty(totalXP, partySize) {
  const budgets = getBudgets(partySize);

  if (totalXP === 0)                return { tier: "none",     label: "No Encounter", color: "#888888" };
  if (totalXP < budgets.trivial)    return { tier: "trivial",  label: "Trivial",      color: "#aaaaaa" };
  if (totalXP < budgets.low)        return { tier: "trivial",  label: "Trivial",      color: "#aaaaaa" };
  if (totalXP < budgets.moderate)   return { tier: "low",      label: "Low",          color: "#4caf50" };
  if (totalXP < budgets.severe)     return { tier: "moderate", label: "Moderate",     color: "#2196f3" };
  if (totalXP < budgets.extreme)    return { tier: "severe",   label: "Severe",       color: "#ff9800" };
  return                                   { tier: "extreme",  label: "Extreme",      color: "#f44336" };
}

// ---------------------------------------------------------------------------
// Party level helpers
// ---------------------------------------------------------------------------

/**
 * Given an array of character levels, returns average (floor) and highest.
 *
 * @param {number[]} levels - Array of PC levels
 * @returns {{ average: number, highest: number, levels: number[] }}
 */
export function computePartyLevels(levels) {
  if (!levels.length) return { average: 1, highest: 1, levels: [] };

  const highest = Math.max(...levels);
  const average = Math.floor(levels.reduce((sum, l) => sum + l, 0) / levels.length);

  return { average, highest, levels };
}

// ---------------------------------------------------------------------------
// Full encounter summary — convenience wrapper used by the Application class
// ---------------------------------------------------------------------------

/**
 * Given all encounter entries and party info, returns a complete summary.
 *
 * @param {Array<{
 *   id: string,
 *   name: string,
 *   baseLevel: number,
 *   adjustment: 'none'|'elite'|'weak',
 *   isHazard: boolean,
 *   isComplex: boolean
 * }>} entries
 * @param {number} partyLevel
 * @param {number} partySize
 * @returns {{ entries: Array, totalXP: number, budgets: object, difficulty: object }}
 */
export function summarizeEncounter(entries, partyLevel, partySize) {
  const budgets = getBudgets(partySize);

  const enriched = entries.map((entry) => {
    const effectiveLevel = applyAdjustment(entry.baseLevel, entry.adjustment);

    const { xp, diff, outOfRange } = entry.isHazard
      ? getHazardXP(effectiveLevel, entry.isComplex, partyLevel)
      : getCreatureXP(effectiveLevel, partyLevel);

    return { ...entry, effectiveLevel, xp, diff, outOfRange };
  });

  const totalXP = enriched.reduce((sum, e) => sum + e.xp, 0);
  const difficulty = getDifficulty(totalXP, partySize);

  return { entries: enriched, totalXP, budgets, difficulty };
}
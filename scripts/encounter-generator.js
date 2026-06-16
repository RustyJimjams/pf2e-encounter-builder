/**
 * encounter-generator.js
 * Compendium search, trait/theme matching, and XP-budget encounter assembly.
 * v0.5.0 — adds compendium index caching and selective compendium support.
 */

import { MODULE_ID } from "./main.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRAIT_POOL_THRESHOLD = 10;

const VALID_ACTOR_TYPES = new Set(["npc", "creature", "hazard"]);

const SKIP_PATTERNS = [
  "classes", "archetypes", "ancestries", "backgrounds",
  "equipment", "spells", "feats", "heritages",
];

const SPICE_TIER = {
  1: "low",
  2: "moderate",
  3: "severe",
};

const XP_BY_LEVEL_DELTA = {
  "-4": 10, "-3": 15, "-2": 20, "-1": 30,
   "0": 40,
   "1": 60,  "2": 80,  "3": 120, "4": 160,
};

// ---------------------------------------------------------------------------
// Compendium helpers
// ---------------------------------------------------------------------------

/**
 * Returns all Actor compendiums that could contain creatures/hazards,
 * regardless of whether the GM has opted into them. Used to build the
 * selector checklist.
 * @returns {CompendiumCollection[]}
 */
export function getAllCreatureCompendiums() {
  return game.packs.filter((pack) => {
    if (pack.metadata.type !== "Actor") return false;
    const id = pack.metadata.id ?? pack.collection ?? "";
    return !SKIP_PATTERNS.some((p) => id.toLowerCase().includes(p));
  });
}

/**
 * Returns the subset of creature compendiums the GM has opted into.
 * Falls back to all available compendiums if no selection is stored.
 * @returns {CompendiumCollection[]}
 */
function getSelectedCompendiums() {
  const all = getAllCreatureCompendiums();
  let selected;
  try {
    selected = game.settings.get(MODULE_ID, "selectedCompendiums");
  } catch {
    return all;
  }
  if (!selected || selected.length === 0) return all;
  const selectedSet = new Set(selected);
  return all.filter((p) => selectedSet.has(p.collection));
}

// ---------------------------------------------------------------------------
// Trait / theme helpers
// ---------------------------------------------------------------------------

function getTraits(actor) {
  const raw =
    actor.system?.traits?.value ??
    actor.system?.traits ??
    [];
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  return new Set(arr.map((t) => (typeof t === "string" ? t : t?.value ?? "").toLowerCase()));
}

function getSearchText(actor) {
  const name = actor.name ?? "";
  const desc =
    actor.system?.details?.publicNotes ??
    actor.system?.details?.description?.value ??
    actor.system?.description?.value ??
    "";
  return `${name} ${desc.replace(/<[^>]*>/g, " ")}`.toLowerCase();
}

function parseThemeTerms(theme) {
  const STOP_WORDS = new Set([
    "a", "an", "the", "in", "on", "at", "of", "and", "or",
    "with", "by", "for", "to", "from", "into", "ambush",
    "encounter", "fight", "battle", "scene",
  ]);
  return theme
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreActor(actor, terms) {
  const traits = getTraits(actor);
  let score = 0;
  let traitMatch = false;

  for (const term of terms) {
    if (traits.has(term)) {
      score += 10;
      traitMatch = true;
    } else {
      for (const t of traits) {
        if (t.includes(term)) {
          score += 5;
          traitMatch = true;
          break;
        }
      }
    }
  }

  return { actor, score, traitMatch };
}

// ---------------------------------------------------------------------------
// Level / XP helpers
// ---------------------------------------------------------------------------

function getLevel(actor) {
  return (
    actor.system?.details?.level?.value ??
    actor.system?.level?.value ??
    null
  );
}

function inLevelRange(actor, partyLevel) {
  const level = getLevel(actor);
  if (level === null) return false;
  return level >= partyLevel - 3 && level <= partyLevel + 3;
}

function xpForLevel(effectiveLevel, partyLevel) {
  const delta = Math.max(-4, Math.min(4, effectiveLevel - partyLevel));
  return XP_BY_LEVEL_DELTA[String(delta)] ?? 0;
}

function getBudgetForTier(tier, partySize) {
  const BASE = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
  const base = BASE[tier] ?? 80;
  return base + (partySize - 4) * 20;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/**
 * Loads all actors from the selected compendiums into a flat array.
 * This is the expensive step — call once per session (or on manual rebuild).
 *
 * Strategy: use getIndex() with indexFields first to avoid triggering PF2e's
 * strict trait validation (which logs warnings for deprecated traits like
 * "good"/"evil" that were renamed in recent system versions). Only the fields
 * we actually need are fetched, keeping things fast and quiet.
 *
 * @param {Function} onProgress - Called with a status string as each pack loads
 * @returns {Promise<object[]>} - Array of lightweight actor descriptors
 */
export async function buildIndex(onProgress) {
  const packs = getSelectedCompendiums();
  const seen  = new Set();
  const index = [];

  // Fields we need from the index — avoids loading full documents and
  // bypasses PF2e's DataModel validation that fires on getDocuments().
  const INDEX_FIELDS = [
    "system.details.level.value",
    "system.level.value",
    "system.traits.value",
    "system.details.isComplex",
  ];

  for (const pack of packs) {
    onProgress?.(`Loading ${pack.metadata.label ?? pack.collection}…`);

    let entries;
    try {
      // getIndex() with extra fields is much faster than getDocuments() and
      // does not run DataModel validation, so deprecated trait warnings are
      // never triggered.
      await pack.getIndex({ fields: INDEX_FIELDS });
      entries = pack.index.contents;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index pack ${pack.collection}:`, err);
      continue;
    }

    for (const entry of entries) {
      if (!VALID_ACTOR_TYPES.has(entry.type)) continue;

      // Level from indexed fields
      const level =
        entry.system?.details?.level?.value ??
        entry.system?.level?.value ??
        null;
      if (level === null) continue;

      // Deduplicate by name + level
      const key = `${entry.name?.toLowerCase()}|${level}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Traits from indexed fields — raw array of slugs
      const rawTraits = entry.system?.traits?.value ?? [];
      const traits = rawTraits
        .map((t) => (typeof t === "string" ? t : t?.value ?? "").toLowerCase())
        .filter(Boolean);

      // Build searchText from name only — descriptions aren't in the index.
      // Name-based fallback is still useful (e.g. "zombie", "skeleton").
      const searchText = (entry.name ?? "").toLowerCase();

      index.push({
        name:       entry.name,
        level,
        type:       entry.type,
        isComplex:  entry.system?.details?.isComplex ?? false,
        uuid:       entry.uuid ?? null,
        traits,
        searchText,
      });
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// Pool building from index (fast — no compendium I/O)
// ---------------------------------------------------------------------------

function buildPoolFromIndex(index, terms, partyLevel) {
  const traitMatches = [];
  const textMatches  = [];
  const allInRange   = [];

  for (const entry of index) {
    if (!inLevelRange({ system: { details: { level: { value: entry.level } } } }, partyLevel)) {
      // Inline level check without a full actor object
      const level = entry.level;
      if (level < partyLevel - 3 || level > partyLevel + 3) continue;
    }

    if (terms.length === 0) {
      allInRange.push(entry);
      continue;
    }

    // Score against traits
    const traitSet = new Set(entry.traits);
    let score = 0;
    let traitMatch = false;

    for (const term of terms) {
      if (traitSet.has(term)) {
        score += 10;
        traitMatch = true;
      } else {
        for (const t of traitSet) {
          if (t.includes(term)) {
            score += 5;
            traitMatch = true;
            break;
          }
        }
      }
    }

    if (score > 0) {
      if (traitMatch) traitMatches.push({ entry, score });
      else            textMatches.push({ entry, score });
    } else if (!traitMatch) {
      // Fallback: check searchText
      const matches = terms.some((t) => entry.searchText.includes(t));
      if (matches) textMatches.push({ entry, score: 1 });
    }
  }

  if (terms.length === 0) return shuffle(allInRange);

  traitMatches.sort((a, b) => b.score - a.score);
  textMatches.sort((a, b) => b.score - a.score);

  const pool = traitMatches.map((m) => m.entry);
  if (pool.length < TRAIT_POOL_THRESHOLD) {
    pool.push(...textMatches.map((m) => m.entry));
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Encounter assembly
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assembleEncounter(pool, partyLevel, partySize, tier) {
  const budget   = getBudgetForTier(tier, partySize);
  const shuffled = shuffle(pool);
  const entries  = [];
  let totalXP    = 0;

  for (const entry of shuffled) {
    const xp = xpForLevel(entry.level, partyLevel);
    if (xp <= 0) continue;
    if (totalXP + xp > budget * 1.25 && entries.length > 0) break;

    entries.push({
      id:         Math.random().toString(36).slice(2, 9),
      name:       entry.name,
      baseLevel:  entry.level,
      adjustment: "none",
      isHazard:   entry.type === "hazard",
      isComplex:  entry.isComplex,
      actorUuid:  entry.uuid,
      xp,
    });

    totalXP += xp;
    if (totalXP >= budget) break;
  }

  return { entries, totalXP, budget };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a themed or random encounter from the provided index.
 * The index must be built first via buildIndex().
 *
 * @param {object} opts
 * @param {object[]} opts.index      - Cached actor index from buildIndex()
 * @param {string}   opts.theme      - Raw theme string (empty = random)
 * @param {number}   opts.spice      - 1 | 2 | 3
 * @param {number}   opts.partyLevel
 * @param {number}   opts.partySize
 * @returns {{ entries: object[], totalXP: number, budget: number, tier: string } | null}
 */
export function generateEncounter({ index, theme, spice, partyLevel, partySize }) {
  const tier  = SPICE_TIER[spice] ?? "moderate";
  const terms = theme ? parseThemeTerms(theme) : [];
  const pool  = buildPoolFromIndex(index, terms, partyLevel);

  if (pool.length === 0) return null;

  const result = assembleEncounter(pool, partyLevel, partySize, tier);
  return { ...result, tier };
}

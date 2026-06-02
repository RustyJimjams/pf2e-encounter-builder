/**
 * encounter-generator.js
 * Compendium search, trait/theme matching, and XP-budget encounter assembly.
 * Kept separate from EncounterBuilder to stay testable and self-contained.
 */

import { MODULE_ID } from "./main.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum number of trait-matched creatures before we fall back to
 * name/description search to supplement the pool.
 */
const TRAIT_POOL_THRESHOLD = 10;

/**
 * Actor types we want to include in generation.
 * Excludes character, vehicle, familiar, loot, etc.
 */
const VALID_ACTOR_TYPES = new Set(["npc", "creature", "hazard"]);

/**
 * XP budget multipliers per difficulty tier, keyed by spice level.
 * The generator targets the *upper* budget of the tier so the encounter
 * fills out nicely. The GM can always weaken a creature.
 */
const SPICE_TIER = {
  1: "low",       // Mild   — Low difficulty
  2: "moderate",  // Medium — Moderate/Severe boundary
  3: "severe",    // Hot    — Severe (extreme is rarely fun to auto-gen)
};

// ---------------------------------------------------------------------------
// Compendium helpers
// ---------------------------------------------------------------------------

/**
 * Returns all enabled actor compendiums that could contain creatures/hazards.
 * Skips system compendiums that only hold PC-facing content.
 * @returns {CompendiumCollection[]}
 */
function getCreatureCompendiums() {
  return game.packs.filter((pack) => {
    if (pack.metadata.type !== "Actor") return false;

    // Skip compendiums that are purely PC-class / archetype / ancestry content.
    // These are identified by common system compendium name patterns.
    const id = pack.metadata.id ?? pack.collection ?? "";
    const skipPatterns = [
      "classes", "archetypes", "ancestries", "backgrounds",
      "equipment", "spells", "feats", "heritages",
    ];
    return !skipPatterns.some((p) => id.toLowerCase().includes(p));
  });
}

/**
 * Loads all documents from a compendium and filters to valid actor types.
 * Shows a progress notification while loading.
 * @param {CompendiumCollection} pack
 * @returns {Promise<Actor[]>}
 */
async function loadPackActors(pack) {
  const docs = await pack.getDocuments();
  return docs.filter((d) => VALID_ACTOR_TYPES.has(d.type));
}

// ---------------------------------------------------------------------------
// Trait / theme extraction
// ---------------------------------------------------------------------------

/**
 * Returns the trait slugs for an actor as a Set of lowercase strings.
 * @param {Actor} actor
 * @returns {Set<string>}
 */
function getTraits(actor) {
  const raw =
    actor.system?.traits?.value ??
    actor.system?.traits ??
    [];
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  return new Set(arr.map((t) => (typeof t === "string" ? t : t?.value ?? "").toLowerCase()));
}

/**
 * Extracts searchable text from an actor for fallback name/description matching.
 * @param {Actor} actor
 * @returns {string}
 */
function getSearchText(actor) {
  const name = actor.name ?? "";
  const desc =
    actor.system?.details?.publicNotes ??
    actor.system?.details?.description?.value ??
    actor.system?.description?.value ??
    "";
  // Strip HTML tags from description
  const plainDesc = desc.replace(/<[^>]*>/g, " ");
  return `${name} ${plainDesc}`.toLowerCase();
}

/**
 * Parses a theme string into an array of lowercase search terms.
 * e.g. "undead ambush in a crypt" → ["undead", "ambush", "crypt"]
 * Strips common stop words that aren't useful for matching.
 * @param {string} theme
 * @returns {string[]}
 */
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

/**
 * Scores a single actor against a set of search terms.
 * Trait matches score higher than name/description matches.
 * @param {Actor} actor
 * @param {string[]} terms
 * @returns {{ actor: Actor, score: number, traitMatch: boolean }}
 */
function scoreActor(actor, terms) {
  const traits = getTraits(actor);
  let score = 0;
  let traitMatch = false;

  for (const term of terms) {
    if (traits.has(term)) {
      score += 10; // Trait match — high confidence
      traitMatch = true;
    } else if (traits.size > 0) {
      // Partial trait match (term is a substring of a trait)
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
// Level helpers
// ---------------------------------------------------------------------------

/**
 * Returns the actor's level as a number, or null if unknown.
 * @param {Actor} actor
 * @returns {number|null}
 */
function getLevel(actor) {
  return (
    actor.system?.details?.level?.value ??
    actor.system?.level?.value ??
    null
  );
}

/**
 * Checks whether an actor's level is within the valid XP range for a given party level.
 * PF2e rules: creatures outside ±4 levels give 0 meaningful XP.
 * We use ±3 for generation to keep encounters coherent.
 * @param {Actor} actor
 * @param {number} partyLevel
 * @returns {boolean}
 */
function inLevelRange(actor, partyLevel) {
  const level = getLevel(actor);
  if (level === null) return false;
  return level >= partyLevel - 3 && level <= partyLevel + 3;
}

// ---------------------------------------------------------------------------
// XP lookup (mirrors xp-calculator.js logic to stay self-contained)
// ---------------------------------------------------------------------------

/**
 * XP values per creature level relative to party level.
 * Source: PF2e Core Rulebook, Encounter Building table.
 */
const XP_BY_LEVEL_DELTA = {
  "-4": 10, "-3": 15, "-2": 20, "-1": 30,
   "0": 40,
   "1": 60,  "2": 80,  "3": 120, "4": 160,
};

/**
 * Returns the XP value of a creature at the given effective level
 * relative to the party level.
 * @param {number} effectiveLevel
 * @param {number} partyLevel
 * @returns {number}
 */
function xpForLevel(effectiveLevel, partyLevel) {
  const delta = Math.max(-4, Math.min(4, effectiveLevel - partyLevel));
  return XP_BY_LEVEL_DELTA[String(delta)] ?? 0;
}

/**
 * Returns the XP budget for a given difficulty tier, adjusted for party size.
 * Base budgets are for 4 players; each player beyond 4 adds 20% of the
 * Moderate budget (20 XP), and each player below 4 subtracts the same.
 * @param {string} tier - "trivial"|"low"|"moderate"|"severe"|"extreme"
 * @param {number} partySize
 * @returns {number}
 */
function getBudgetForTier(tier, partySize) {
  const BASE = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
  const base = BASE[tier] ?? 80;
  const adjustment = (partySize - 4) * 20;
  return base + adjustment;
}

// ---------------------------------------------------------------------------
// Pool building
// ---------------------------------------------------------------------------

/**
 * Searches all eligible compendiums for actors matching the given terms.
 * Uses trait-priority matching with name/description fallback.
 *
 * @param {string[]} terms      - Parsed theme terms (empty = random mode)
 * @param {number}   partyLevel
 * @param {Function} onProgress - Called with (packName) as each pack loads
 * @returns {Promise<Actor[]>}  - Filtered, scored, deduplicated candidate pool
 */
async function buildCandidatePool(terms, partyLevel, onProgress) {
  const packs = getCreatureCompendiums();
  const seen  = new Set(); // deduplicate by actor name + level
  const traitMatches = [];
  const textMatches  = [];
  const allInRange   = []; // for random mode (no terms)

  for (const pack of packs) {
    onProgress?.(pack.metadata.label ?? pack.collection);

    let actors;
    try {
      actors = await loadPackActors(pack);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not load pack ${pack.collection}:`, err);
      continue;
    }

    for (const actor of actors) {
      if (!inLevelRange(actor, partyLevel)) continue;

      // Deduplicate: same name + same level = same creature from different packs
      const level = getLevel(actor);
      const dedupeKey = `${actor.name?.toLowerCase()}|${level}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (terms.length === 0) {
        // Random mode — no theme filtering
        allInRange.push(actor);
        continue;
      }

      const { score, traitMatch } = scoreActor(actor, terms);

      if (score > 0) {
        if (traitMatch) {
          traitMatches.push({ actor, score });
        } else {
          textMatches.push({ actor, score });
        }
      }
    }
  }

  // Random mode: return everything in range, shuffled
  if (terms.length === 0) {
    return shuffle(allInRange);
  }

  // Sort each group by score descending
  traitMatches.sort((a, b) => b.score - a.score);
  textMatches.sort((a, b) => b.score - a.score);

  // If trait pool is thin, supplement with text matches
  const pool = traitMatches.map((m) => m.actor);
  if (pool.length < TRAIT_POOL_THRESHOLD) {
    pool.push(...textMatches.map((m) => m.actor));
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Encounter assembly
// ---------------------------------------------------------------------------

/**
 * Fisher-Yates shuffle — returns a new shuffled array.
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Assembles a balanced encounter from the candidate pool.
 * Greedily adds creatures until the budget is reached or exceeded by one pick.
 *
 * @param {Actor[]} pool
 * @param {number}  partyLevel
 * @param {number}  partySize
 * @param {string}  tier        - Difficulty tier name
 * @returns {{ entries: object[], totalXP: number, budget: number }}
 */
function assembleEncounter(pool, partyLevel, partySize, tier) {
  const budget  = getBudgetForTier(tier, partySize);
  const shuffled = shuffle(pool);

  const entries  = [];
  let totalXP    = 0;

  for (const actor of shuffled) {
    const level = getLevel(actor);
    const xp    = xpForLevel(level, partyLevel);

    if (xp <= 0) continue;

    // Stop if adding this creature would exceed budget AND we already have entries
    if (totalXP + xp > budget * 1.25 && entries.length > 0) break;

    entries.push({
      id:        Math.random().toString(36).slice(2, 9),
      name:      actor.name,
      baseLevel: level,
      adjustment: "none",
      isHazard:  actor.type === "hazard",
      isComplex: actor.system?.details?.isComplex ?? false,
      actorUuid: actor.uuid ?? null,
      xp,
    });

    totalXP += xp;

    // Stop once we've reasonably filled the budget
    if (totalXP >= budget) break;
  }

  return { entries, totalXP, budget };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a themed encounter suggestion.
 *
 * @param {object} opts
 * @param {string}   opts.theme       - Raw theme string from GM input (empty = random)
 * @param {number}   opts.spice       - 1 | 2 | 3
 * @param {number}   opts.partyLevel
 * @param {number}   opts.partySize
 * @param {Function} opts.onProgress  - Called with status strings during loading
 * @returns {Promise<{ entries: object[], totalXP: number, budget: number, tier: string } | null>}
 */
export async function generateEncounter({ theme, spice, partyLevel, partySize, onProgress }) {
  const tier  = SPICE_TIER[spice] ?? "moderate";
  const terms = theme ? parseThemeTerms(theme) : [];

  onProgress?.("Searching compendiums…");

  const pool = await buildCandidatePool(terms, partyLevel, (packName) => {
    onProgress?.(`Loading ${packName}…`);
  });

  if (pool.length === 0) {
    return null; // Caller handles the empty-pool case
  }

  onProgress?.("Assembling encounter…");

  const result = assembleEncounter(pool, partyLevel, partySize, tier);
  return { ...result, tier };
}

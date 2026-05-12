# PF2e Encounter Builder — Project Log

## Overview

A GM-facing Foundry VTT module for planning and balancing Pathfinder 2e encounters using the official XP budget system. Built natively as a Foundry module so it lives where the GM already works, with no import/export step required.

---

## V1 — Completed

### What It Does
- **Auto-detects party data** — reads all active player-owned characters from the world, calculates average level, highest level, and detected party size automatically
- **Party level flexibility** — GM can choose between average level, highest level, or a manual override; all three values are shown simultaneously so the GM can make an informed choice
- **Party size override** — detected size is used by default, with an optional manual override for absent players or cohorts
- **XP budget display** — all five difficulty tiers (Trivial/Low/Moderate/Severe/Extreme) are shown at once with their XP thresholds, automatically adjusted for party size
- **Live difficulty rating** — a color-coded badge and progress bar update in real time as creatures are added
- **Drag and drop** — accepts actor drops from any compendium, including homebrew; reads level automatically from PF2e actor data, prompts GM to set manually if not found
- **Elite/Weak toggles** — per-creature buttons shift effective level ±1 and instantly recalculate XP cost
- **Hazards section** — collapsible, detects Simple vs Complex automatically, applies the +4 level bonus to Complex hazards per the rules
- **Floating window** — GM-only, resizable, draggable, remembers position between sessions
- **Persistent settings** — party level mode and party size override persist between sessions via Foundry's settings API

### File Structure
```
pf2e-encounter-builder/
├── module.json
├── lang/
│   └── en.json
├── scripts/
│   ├── main.js
│   ├── xp-calculator.js
│   └── encounter-builder.js
├── templates/
│   └── encounter-builder.hbs
└── styles/
    └── encounter-builder.css
```

### Technical Notes
- Built targeting Foundry v14, PF2e system v6+
- Uses Foundry's `Application` class (v1 framework — see Known Issues)
- XP math is fully isolated in `xp-calculator.js` with no Foundry dependencies
- Module hosted on GitHub for installation via manifest URL

### Known Issues / Deprecation Warnings
- **`Application` vs `ApplicationV2`** — the window class uses Foundry's v1 Application framework, which is deprecated as of v13 and will be removed in v16. Flagged for v2 upgrade.
- **`onClick` vs `onChange`** — the toolbar button uses the deprecated `onClick` handler. Flagged for v2 upgrade.
- Both are warnings only — nothing breaks in v14.

---

## V2 — Planned

### Push to Scene
The headline v2 feature. A **"Create Scene"** button at the bottom of the builder will:

1. Prompt the GM for a scene name
2. Create a blank Foundry scene with sensible defaults
3. Import fresh actor copies from their compendium UUIDs into the world
4. Place tokens in a spiral cluster at the center of the scene so nothing overlaps
5. Activate the new scene automatically
6. Ask the GM whether to close the builder or keep it open (to allow building multiple scenes in one session)

**Design decisions:**
- Tokens placed in a spiral pattern outward from scene center, spaced to avoid overlap
- Always creates fresh actor copies regardless of whether the actor already exists in the world
- Scene naming is always prompted — no auto-generated names

### Framework Upgrades
- Migrate from `Application` to `ApplicationV2` for Foundry v14/v15 forward compatibility
- Replace deprecated `onClick` toolbar handler with `onChange`

### Future Considerations (Post-V2)
- Save and load named encounters
- Send creatures directly to the Combat Tracker without creating a scene
- Search and filter within the builder rather than hunting through compendiums
- Reorder encounter entries by drag-and-drop within the list

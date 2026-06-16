# PF2e Encounter Builder
A GM tool for planning and balancing Pathfinder 2e encounters from within Foundry VTT. No external apps, no import/export — everything lives where you already work.

## Features

### Encounter Planning
- **Auto-detects party data** — reads all active player-owned characters and calculates party level and size automatically
- **Flexible party level** — choose between average level, highest level, or a manual override; all three values are shown simultaneously
- **Party size override** — manually adjust for absent players or cohorts
- **Live XP budget** — all five difficulty tiers (Trivial / Low / Moderate / Severe / Extreme) shown at once, automatically adjusted for party size
- **Live difficulty rating** — color-coded badge and progress bar update in real time as you build
- **Drag and drop** — drop actors from any compendium directly into the builder, including homebrew
- **Elite / Weak toggles** — per-creature buttons shift effective level ±1 and instantly recalculate XP
- **Hazards** — collapsible section with automatic Simple vs Complex detection; applies the +4 level bonus to Complex hazards per the rules

### Encounter Generation
- **NEW** **Compendium Selection and Caching** - Select which compendiums to use for encounter generation.
- **Suggest Encounter** — one-click random encounter generation; picks a difficulty and fills the XP budget with creatures drawn from your enabled compendiums
- **Generate Encounter** — theme-driven generation; describe what you want (`undead crypt`, `fey forest`, `fire giant`) and choose a spice level:
  - 🌶 **Mild** — Low difficulty
  - 🌶🌶 **Medium** — Moderate difficulty
  - 🌶🌶🌶 **Hot** — Severe difficulty
- **Compendium-agnostic** — searches all enabled Actor compendiums including homebrew, as long as creatures are tagged with standard PF2e traits
- **Non-destructive preview** — generated encounters appear in a pending panel for review; Accept, Reroll, or Discard before committing to your encounter list
- **Budget-aware assembly** — fills the XP budget as completely as possible; one creature may push slightly over, which the GM can correct with a Weak toggle

> **Note on generation speed:** Encounter generation searches your enabled compendiums by loading full actor data. On worlds with large compendium collections — including the core PF2e bestiaries — this can take several seconds. Progress is shown via notifications in the top-left corner of Foundry while the search runs.

### Scene & Combat Tools
- **Create Encounter Scene** — creates a blank scene, imports fresh actor copies, and places tokens in a spiral cluster ready for a map
- **Add to Combat Tracker** — pushes actors directly into initiative without creating a scene; ideal for theatre of the mind. Detects an active combat and asks whether to clear and replace or add to the existing tracker
- **Push to Scene** — select any existing scene from a dropdown and push tokens directly onto it in a spiral cluster; ideal for when you've already set up a map and just need to populate it

### Interface
- Floating window — GM-only, resizable, draggable, remembers position between sessions
- Opens from the token controls toolbar

## Installation
Install via manifest URL in Foundry's Add-on Module installer:
```
https://raw.githubusercontent.com/RustyJimjams/pf2e-encounter-builder/main/module.json
```

## Requirements
- Foundry VTT v13+
- Pathfinder 2e system v6.0.0+

## Compatibility
- Verified on Foundry v14 (Build 361) with PF2e system v8.1.2

## Known Issues
- Token placement on created or targeted scenes is approximate — tokens are clustered near center but may not be pixel-perfect on the grid.
- Homebrew compendium support depends on creators following standard PF2e trait conventions. Untagged creatures will not appear in themed generation results.

## Changelog

### 0.5.7
- Added **In-Window Compendium Selection** — Select which Compendium(s) to use with the Encounter Generator function.
- Added Compendium indexing/caching, so Encounter Builder remembers which Compendiums to use for Generation, and accelerates encounter generation.
- **NOTE** The first generation also builds the index, so it will be slower. Subsequent generations will be much faster. To add/change which Compendiums are being used with the Generator, click the "Rebuild" button after changing/selecting Compendiums.

### 0.4.0
- Added **Suggest Encounter** — one-click random balanced encounter generation
- Added **Generate Encounter** — theme and trait-driven generation with spice level picker
- Generated encounters appear in a non-destructive pending panel with Accept, Reroll, and Discard controls
- Added `encounter-generator.js` — self-contained compendium search, trait matching, and XP budget assembly
- Migrated from deprecated `Application` base class to `ApplicationV2` + `HandlebarsApplicationMixin` for Foundry v13+ compatibility
- All dialogs updated from `Dialog` to `DialogV2`

### 0.3.0
- Added **Push to Scene** — select an existing scene from a list and push encounter tokens onto it without creating a new scene

### 0.2.0
- Added **Create Encounter Scene** — blank scene with spiral token placement
- Added **Add to Combat Tracker** — theatre of the mind support with active combat detection and immediate initiative prompts

### 0.1.0
- Initial release
- Party detection, XP budget display, drag-and-drop creatures and hazards, Elite/Weak toggles

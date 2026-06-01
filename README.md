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

### Scene & Combat Tools
- **Create Encounter Scene** — creates a blank scene, imports fresh actor copies, and places tokens in a cluster ready for a map
- **Add to Combat Tracker** — pushes actors directly into initiative without creating a scene; ideal for theatre of the mind. Detects an active combat and asks whether to clear and replace or add to the existing tracker
- **Push to Scene** — select any existing scene from a dropdown and push tokens directly onto it in a spiral cluster. Ideal for when you've already set up a map and just need to populate it.

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

- Token placement on created scenes is approximate — tokens are clustered near center but may not be pixel-perfect on the grid.

## Changelog

### 0.4.0
- Migration to ApplicationV2

### 0.3.0
- Added Push to Scene — select an existing scene from a list and push encounter tokens onto it without creating a new scene

### 0.2.0
- Added **Create Encounter Scene** — blank scene with spiral token placement
- Added **Add to Combat Tracker** — theatre of the mind support with active combat detection and immediate initiative prompts

### 0.1.0
- Initial release
- Party detection, XP budget display, drag-and-drop creatures and hazards, Elite/Weak toggles

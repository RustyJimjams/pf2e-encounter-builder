/**
 * main.js
 * Entry point for the PF2e Encounter Builder module.
 * Registers Foundry hooks, adds the toolbar button, and manages the
 * singleton window instance.
 */

import { EncounterBuilder } from "./encounter-builder.js";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

export const MODULE_ID = "pf2e-encounter-builder";

// ---------------------------------------------------------------------------
// Single shared instance of the encounter builder window
// ---------------------------------------------------------------------------

let _builderInstance = null;

/**
 * Returns the singleton EncounterBuilder instance, creating it if needed.
 * @returns {EncounterBuilder}
 */
function getBuilder() {
  if (!_builderInstance) {
    _builderInstance = new EncounterBuilder();
  }
  return _builderInstance;
}

/**
 * Toggles the encounter builder window open or closed.
 */
function toggleBuilder() {
  const builder = getBuilder();

  if (builder.rendered) {
    builder.close();
  } else {
    builder.render(true);
  }
}

// ---------------------------------------------------------------------------
// Hook: init
// Register module settings here so they're available before anything renders.
// ---------------------------------------------------------------------------

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing PF2e Encounter Builder`);

  // Party level mode preference (persists across sessions)
  game.settings.register(MODULE_ID, "partyLevelMode", {
    name: "Party Level Mode",
    hint: "Which party level calculation to use by default.",
    scope: "client",
    config: false, // managed in-window, not in the settings menu
    type: String,
    choices: {
      average: "Average Level",
      highest: "Highest Level",
      manual:  "Manual Override",
    },
    default: "average",
  });

  // Manual party level override value
  game.settings.register(MODULE_ID, "manualPartyLevel", {
    name: "Manual Party Level",
    scope: "client",
    config: false,
    type: Number,
    default: 1,
  });

  // Manual party size override value
  game.settings.register(MODULE_ID, "manualPartySize", {
    name: "Manual Party Size",
    scope: "client",
    config: false,
    type: Number,
    default: 4,
  });

  // Whether to use the manual party size override
  game.settings.register(MODULE_ID, "overridePartySize", {
    name: "Override Party Size",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  // Whether the hazards section is expanded
  game.settings.register(MODULE_ID, "hazardsExpanded", {
    name: "Hazards Section Expanded",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });
});

// ---------------------------------------------------------------------------
// Hook: ready
// Everything is loaded — add the toolbar button and set up drop listeners.
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  // Only show the tool to GMs
  if (!game.user.isGM) return;

  console.log(`${MODULE_ID} | Ready`);
});

// ---------------------------------------------------------------------------
// Hook: getSceneControlButtons
// Adds our button to Foundry's left toolbar (Token Controls group).
// ---------------------------------------------------------------------------

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  controls.tokens = controls.tokens ?? {};
  controls.tokens.tools = controls.tokens.tools ?? {};

controls.tokens.tools["encounter-builder"] = {
  name: "encounter-builder",
  title: "Encounter Builder",
  icon: "fa-solid fa-dice-d20",
  button: true,
  visible: true,
  onClick: () => toggleBuilder(),
  onChange: () => toggleBuilder(),
  order: 100,
};
});

// ---------------------------------------------------------------------------
// Hook: renderActorDirectory
// Not strictly needed for v1, but sets up a future hook point for
// dragging directly from the Actor sidebar tab.
// ---------------------------------------------------------------------------

// (Placeholder — drag-and-drop from compendiums is handled inside
// EncounterBuilder._onDrop, which intercepts Foundry's native drop events.)

// ---------------------------------------------------------------------------
// Expose module API on game.modules for debugging and potential
// inter-module compatibility down the road.
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const api = {
    openBuilder: () => getBuilder().render(true),
    closeBuilder: () => getBuilder().close(),
    getBuilder,
  };

  game.modules.get(MODULE_ID).api = api;
});
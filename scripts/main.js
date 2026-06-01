/**
 * main.js
 * Entry point for the PF2e Encounter Builder module.
 * Registers Foundry hooks, adds the toolbar button, and manages the
 * singleton window instance.
 *
 * Migration notes (Application → ApplicationV2):
 *  - builder.rendered is still valid on ApplicationV2
 *  - getSceneControlButtons signature changed in v13: receives a Map-like
 *    controls object; check your Foundry version if the button doesn't appear
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

  game.settings.register(MODULE_ID, "partyLevelMode", {
    name: "Party Level Mode",
    hint: "Which party level calculation to use by default.",
    scope: "client",
    config: false,
    type: String,
    choices: {
      average: "Average Level",
      highest: "Highest Level",
      manual:  "Manual Override",
    },
    default: "average",
  });

  game.settings.register(MODULE_ID, "manualPartyLevel", {
    name: "Manual Party Level",
    scope: "client",
    config: false,
    type: Number,
    default: 1,
  });

  game.settings.register(MODULE_ID, "manualPartySize", {
    name: "Manual Party Size",
    scope: "client",
    config: false,
    type: Number,
    default: 4,
  });

  game.settings.register(MODULE_ID, "overridePartySize", {
    name: "Override Party Size",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

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
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  console.log(`${MODULE_ID} | Ready`);

  // Expose module API for debugging and inter-module use
  const api = {
    openBuilder:  () => getBuilder().render(true),
    closeBuilder: () => getBuilder().close(),
    getBuilder,
  };
  game.modules.get(MODULE_ID).api = api;

  // Fallback click listener in case the toolbar hook doesn't fire
  setTimeout(() => {
    const btn = document.querySelector('[data-tool="encounter-builder"]');
    if (btn) btn.addEventListener("click", () => toggleBuilder());
  }, 1000);
});

// ---------------------------------------------------------------------------
// Hook: getSceneControlButtons
// Foundry v13 changed the controls argument from a plain array to an object
// keyed by group name. Both shapes are handled below.
// ---------------------------------------------------------------------------

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  // v13+: controls is a plain object — controls.tokens is the token group
  if (controls && typeof controls === "object" && !Array.isArray(controls)) {
    controls.tokens ??= {};
    controls.tokens.tools ??= {};
    controls.tokens.tools["encounter-builder"] = {
      name:     "encounter-builder",
      title:    "Encounter Builder",
      icon:     "fa-solid fa-dice-d20",
      button:   true,
      visible:  true,
      onClick:  () => toggleBuilder(),
      onChange: () => toggleBuilder(),
      order:    100,
    };
    return;
  }

  // Older fallback: controls is an array of control groups
  if (Array.isArray(controls)) {
    const tokenControls = controls.find((c) => c.name === "token");
    if (!tokenControls) return;
    tokenControls.tools ??= [];
    tokenControls.tools.push({
      name:    "encounter-builder",
      title:   "Encounter Builder",
      icon:    "fa-solid fa-dice-d20",
      button:  true,
      visible: true,
      onClick: () => toggleBuilder(),
    });
  }
});

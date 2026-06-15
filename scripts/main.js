/**
 * main.js
 * Entry point for the PF2e Encounter Builder module.
 * v0.5.0 — adds selectedCompendiums setting for generation scoping.
 */

import { EncounterBuilder } from "./encounter-builder.js";

export const MODULE_ID = "pf2e-encounter-builder";

let _builderInstance = null;

/**
 * Called by EncounterBuilder._onClose to invalidate the singleton.
 * Exported so the class can call back into main without a circular dep.
 */
export function resetBuilderInstance() {
  _builderInstance = null;
}

function getBuilder() {
  // If the instance exists but is no longer rendered and has been closed,
  // discard it and create a fresh one to avoid stale ApplicationV2 state.
  if (_builderInstance && !_builderInstance.rendered) {
    _builderInstance = null;
  }
  if (!_builderInstance) _builderInstance = new EncounterBuilder();
  return _builderInstance;
}

function toggleBuilder() {
  const builder = getBuilder();
  if (builder.rendered) builder.close();
  else builder.render(true);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing PF2e Encounter Builder`);

  game.settings.register(MODULE_ID, "partyLevelMode", {
    name: "Party Level Mode",
    hint: "Which party level calculation to use by default.",
    scope: "client", config: false, type: String,
    choices: { average: "Average Level", highest: "Highest Level", manual: "Manual Override" },
    default: "average",
  });

  game.settings.register(MODULE_ID, "manualPartyLevel", {
    name: "Manual Party Level",
    scope: "client", config: false, type: Number, default: 1,
  });

  game.settings.register(MODULE_ID, "manualPartySize", {
    name: "Manual Party Size",
    scope: "client", config: false, type: Number, default: 4,
  });

  game.settings.register(MODULE_ID, "overridePartySize", {
    name: "Override Party Size",
    scope: "client", config: false, type: Boolean, default: false,
  });

  game.settings.register(MODULE_ID, "hazardsExpanded", {
    name: "Hazards Section Expanded",
    scope: "client", config: false, type: Boolean, default: false,
  });

  // Which compendium collection IDs to include in encounter generation.
  // Empty array = use all available creature/hazard compendiums.
  game.settings.register(MODULE_ID, "selectedCompendiums", {
    name: "Selected Compendiums for Generation",
    scope: "client", config: false, type: Array, default: [],
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  console.log(`${MODULE_ID} | Ready`);

  game.modules.get(MODULE_ID).api = {
    openBuilder:  () => getBuilder().render(true),
    closeBuilder: () => getBuilder().close(),
    getBuilder,
  };

  setTimeout(() => {
    const btn = document.querySelector('[data-tool="encounter-builder"]');
    if (btn) btn.addEventListener("click", () => toggleBuilder());
  }, 1000);
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  if (controls && typeof controls === "object" && !Array.isArray(controls)) {
    controls.tokens ??= {};
    controls.tokens.tools ??= {};
    controls.tokens.tools["encounter-builder"] = {
      name: "encounter-builder", title: "Encounter Builder",
      icon: "fa-solid fa-dice-d20", button: true, visible: true,
      onClick: () => toggleBuilder(), onChange: () => toggleBuilder(), order: 100,
    };
    return;
  }

  if (Array.isArray(controls)) {
    const tokenControls = controls.find((c) => c.name === "token");
    if (!tokenControls) return;
    tokenControls.tools ??= [];
    tokenControls.tools.push({
      name: "encounter-builder", title: "Encounter Builder",
      icon: "fa-solid fa-dice-d20", button: true, visible: true,
      onClick: () => toggleBuilder(),
    });
  }
});

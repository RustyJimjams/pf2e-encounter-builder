/**
 * encounter-builder.js
 * The main ApplicationV2 class for the PF2e Encounter Builder.
 * Migrated from Application (v1) → ApplicationV2 + HandlebarsApplicationMixin (v13+).
 *
 * Key changes from the old Application base:
 *  - static DEFAULT_OPTIONS replaces static defaultOptions + mergeObject
 *  - PARTS declares named Handlebars partials; _renderHTML / _replaceHTML handle rendering
 *  - _onRender(context, options) replaces activateListeners(html) — no jQuery
 *  - this.element is the root HTMLElement, not a jQuery wrapper
 *  - Drag-and-drop wired via _setupDragDrop / DragDrop helper
 */

import { MODULE_ID } from "./main.js";
import {
  computePartyLevels,
  summarizeEncounter,
  getBudgets,
} from "./xp-calculator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads all active player-owned characters from the world and returns
 * their levels as an array.
 * @returns {number[]}
 */
function getPartyLevels() {
  return game.actors
    .filter((a) => a.type === "character" && a.hasPlayerOwner && !a.isToken)
    .map((a) => a.system.details.level.value ?? 1);
}

/**
 * Attempts to extract the level of a dropped actor.
 * Works for creatures, NPCs, and hazards in the PF2e system.
 * @param {Actor} actor
 * @returns {number|null}
 */
function getActorLevel(actor) {
  return (
    actor.system?.details?.level?.value ??
    actor.system?.level?.value ??
    null
  );
}

/**
 * Determines if a dropped actor is a hazard.
 * @param {Actor} actor
 * @returns {boolean}
 */
function isHazardActor(actor) {
  return actor.type === "hazard";
}

/**
 * Determines if a hazard actor is complex.
 * @param {Actor} actor
 * @returns {boolean}
 */
function isComplexHazard(actor) {
  return actor.system?.details?.isComplex ?? false;
}

/**
 * Generates a simple unique ID for encounter entries.
 * @returns {string}
 */
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Spiral placement helper
// ---------------------------------------------------------------------------

/**
 * Returns an array of {x, y} positions in a spiral around a center point.
 * @param {number} count    - Number of positions needed
 * @param {number} cx       - Center X in pixels
 * @param {number} cy       - Center Y in pixels
 * @param {number} gridSize - Size of one grid square in pixels
 * @returns {Array<{x: number, y: number}>}
 */
function spiralPositions(count, cx, cy, gridSize) {
  const positions = [];
  positions.push({ x: cx, y: cy });
  if (count <= 1) return positions;

  let x = 0, y = 0;
  let dx = 1, dy = 0;
  let steps = 1, stepCount = 0, turns = 0;

  while (positions.length < count) {
    x += dx;
    y += dy;
    positions.push({ x: cx + x * gridSize, y: cy + y * gridSize });

    stepCount++;
    if (stepCount === steps) {
      stepCount = 0;
      [dx, dy] = [-dy, dx];
      turns++;
      if (turns % 2 === 0) steps++;
    }
  }

  return positions.slice(0, count);
}

// ---------------------------------------------------------------------------
// EncounterBuilder — ApplicationV2 + HandlebarsApplicationMixin
// ---------------------------------------------------------------------------

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EncounterBuilder extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super(options);

    this._entries          = [];
    this._partyLevelMode   = game.settings.get(MODULE_ID, "partyLevelMode");
    this._manualPartyLevel = game.settings.get(MODULE_ID, "manualPartyLevel");
    this._manualPartySize  = game.settings.get(MODULE_ID, "manualPartySize");
    this._overridePartySize = game.settings.get(MODULE_ID, "overridePartySize");
    this._hazardsExpanded  = game.settings.get(MODULE_ID, "hazardsExpanded");
  }

  // ---------------------------------------------------------------------------
  // ApplicationV2 configuration
  // ---------------------------------------------------------------------------

  static DEFAULT_OPTIONS = {
    id: "pf2e-encounter-builder",
    window: {
      title: "Encounter Builder",
      resizable: true,
    },
    position: {
      width: 520,
      height: 680,
    },
    classes: ["pf2e-encounter-builder"],
  };

  static PARTS = {
    main: {
      template: "modules/pf2e-encounter-builder/templates/encounter-builder.hbs",
    },
  };

  // ---------------------------------------------------------------------------
  // Context — passed to the Handlebars template on every render
  // ---------------------------------------------------------------------------

  async _prepareContext(options) {
    const rawLevels = getPartyLevels();
    const { average, highest } = computePartyLevels(rawLevels);

    const activePartyLevel = this._resolvePartyLevel(average, highest);

    const detectedSize  = rawLevels.length || 4;
    const activePartySize = this._overridePartySize
      ? this._manualPartySize
      : detectedSize;

    const summary    = summarizeEncounter(this._entries, activePartyLevel, activePartySize);
    const budgetBars = this._buildBudgetBars(summary.totalXP, summary.budgets);

    const creatures = summary.entries.filter((e) => !e.isHazard).map((e) => ({
      ...e,
      adjustmentNone:  e.adjustment === "none",
      adjustmentElite: e.adjustment === "elite",
      adjustmentWeak:  e.adjustment === "weak",
    }));
    const hazards = summary.entries.filter((e) => e.isHazard);

    return {
      detectedSize,
      activePartySize,
      overridePartySize:    this._overridePartySize,
      manualPartySize:      this._manualPartySize,
      averageLevel:         average,
      highestLevel:         highest,
      manualPartyLevel:     this._manualPartyLevel,
      partyLevelMode:       this._partyLevelMode,
      activePartyLevel,
      partyLevelModeAverage: this._partyLevelMode === "average",
      partyLevelModeHighest: this._partyLevelMode === "highest",
      partyLevelModeManual:  this._partyLevelMode === "manual",
      creatures,
      hazards,
      totalXP:      summary.totalXP,
      difficulty:   summary.difficulty,
      budgets:      summary.budgets,
      budgetBars,
      hazardsExpanded: this._hazardsExpanded,
      hasCreatures: creatures.length > 0,
      hasHazards:   hazards.length > 0,
      hasEntries:   this._entries.length > 0,
    };
  }

  // ---------------------------------------------------------------------------
  // _onRender — replaces activateListeners; receives plain HTMLElement
  // Called after every render (initial and re-renders).
  // ---------------------------------------------------------------------------

  _onRender(context, options) {
    const html = this.element;

    // --- Party level mode buttons ---
    html.querySelectorAll(".party-level-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => this._setPartyLevelMode(btn.dataset.mode));
    });

    const manualLevelInput = html.querySelector(".manual-party-level");
    if (manualLevelInput) {
      manualLevelInput.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1 && val <= 20) {
          this._manualPartyLevel = val;
          game.settings.set(MODULE_ID, "manualPartyLevel", val);
          this.render();
        }
      });
    }

    // --- Party size override ---
    const sizeToggle = html.querySelector(".party-size-override-toggle");
    if (sizeToggle) {
      sizeToggle.addEventListener("change", (e) => {
        this._overridePartySize = e.target.checked;
        game.settings.set(MODULE_ID, "overridePartySize", this._overridePartySize);
        this.render();
      });
    }

    const manualSizeInput = html.querySelector(".manual-party-size");
    if (manualSizeInput) {
      manualSizeInput.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) {
          this._manualPartySize = val;
          game.settings.set(MODULE_ID, "manualPartySize", val);
          this.render();
        }
      });
    }

    // --- Elite / Weak adjustment buttons ---
    html.querySelectorAll(".adjustment-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entryId = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (entryId) this._setAdjustment(entryId, btn.dataset.adjustment);
      });
    });

    // --- Remove entry buttons ---
    html.querySelectorAll(".remove-entry-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entryId = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (entryId) this._removeEntry(entryId);
      });
    });

    // --- Clear buttons ---
    html.querySelector(".clear-creatures-btn")?.addEventListener("click", () => {
      this._entries = this._entries.filter((e) => e.isHazard);
      this.render();
    });

    html.querySelector(".clear-hazards-btn")?.addEventListener("click", () => {
      this._entries = this._entries.filter((e) => !e.isHazard);
      this.render();
    });

    // --- Hazards collapse toggle ---
    html.querySelector(".hazards-toggle-btn")?.addEventListener("click", () => {
      this._hazardsExpanded = !this._hazardsExpanded;
      game.settings.set(MODULE_ID, "hazardsExpanded", this._hazardsExpanded);
      this.render();
    });

    // --- Scene / tracker action buttons ---
    html.querySelector(".create-scene-btn")?.addEventListener("click", () => this._onCreateScene());
    html.querySelector(".add-to-tracker-btn")?.addEventListener("click", () => this._onAddToTracker());
    html.querySelector(".push-to-scene-btn")?.addEventListener("click", () => this._onPushToScene());

    // --- Drop zones ---
    this._activateDropZone(html.querySelector(".encounter-drop-zone"));
    this._activateDropZone(html.querySelector(".hazard-drop-zone"));
  }

  // ---------------------------------------------------------------------------
  // Drop zone wiring (plain DOM — no jQuery, no DragDrop helper needed here
  // because we're handling arbitrary actor UUIDs, not Foundry Documents)
  // ---------------------------------------------------------------------------

  _activateDropZone(zone) {
    if (!zone) return;

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      zone.classList.add("dragover");
    });

    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));

    zone.addEventListener("drop", (e) => {
      zone.classList.remove("dragover");
      this._onDrop(e);
    });
  }

  // ---------------------------------------------------------------------------
  // Drag and drop — logic unchanged, just wired differently
  // ---------------------------------------------------------------------------

  async _onDrop(event) {
    event.preventDefault();

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return ui.notifications.warn("Encounter Builder: Could not read dropped data.");
    }

    if (data.type !== "Actor") {
      return ui.notifications.warn("Encounter Builder: Only actors (creatures and hazards) can be dropped here.");
    }

    let actor;
    try {
      if (data.uuid) {
        actor = await fromUuid(data.uuid);
      } else if (data.pack && data.id) {
        const pack = game.packs.get(data.pack);
        actor = await pack?.getDocument(data.id);
      } else if (data.id) {
        actor = game.actors.get(data.id);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Error resolving dropped actor:`, err);
    }

    if (!actor) {
      return ui.notifications.warn("Encounter Builder: Could not find that actor.");
    }

    let level = getActorLevel(actor);
    if (level === null) {
      level = await this._promptForLevel(actor.name);
      if (level === null) return;
    }

    const hazard  = isHazardActor(actor);
    const complex = hazard ? isComplexHazard(actor) : false;

    this._entries.push({
      id:         uid(),
      name:       actor.name,
      baseLevel:  level,
      adjustment: "none",
      isHazard:   hazard,
      isComplex:  complex,
      actorUuid:  actor.uuid ?? null,
    });

    this.render();
  }

  // ---------------------------------------------------------------------------
  // Create Scene
  // ---------------------------------------------------------------------------

  async _onCreateScene() {
    if (this._entries.length === 0) {
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards before creating a scene.");
    }

    const sceneName = await this._promptForSceneName();
    if (!sceneName) return;

    ui.notifications.info("Encounter Builder: Creating scene...");

    try {
      const gridSize    = 100;
      const sceneWidth  = 4000;
      const sceneHeight = 3000;

      const [scene] = await Scene.createDocuments([{
        name: sceneName,
        width: sceneWidth,
        height: sceneHeight,
        grid: { type: 1, size: gridSize },
        padding: 0.25,
        backgroundColor: "#000000",
        tokenVision: false,
      }]);

      const cx = Math.floor(sceneWidth  / 2 / gridSize) * gridSize;
      const cy = Math.floor(sceneHeight / 2 / gridSize) * gridSize;
      const positions = spiralPositions(this._entries.length, cx, cy, gridSize);

      const tokenDatas = await this._buildTokenDatas(this._entries, positions);
      await scene.createEmbeddedDocuments("Token", tokenDatas);
      await scene.activate();

      ui.notifications.info(`Encounter Builder: Scene "${sceneName}" created with ${this._entries.length} token(s).`);

      const keepOpen = await this._promptKeepOpen();
      if (!keepOpen) this.close();

    } catch (err) {
      console.error(`${MODULE_ID} | Error creating scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong creating the scene. Check the console for details.");
    }
  }

  // ---------------------------------------------------------------------------
  // Add to Combat Tracker
  // ---------------------------------------------------------------------------

  async _onAddToTracker() {
    if (this._entries.length === 0) {
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards first.");
    }

    try {
      let combat = game.combat;

      if (combat) {
        const replace = await this._promptReplaceOrAppend();
        if (replace === null) return;
        if (replace) {
          await combat.deleteEmbeddedDocuments(
            "Combatant",
            combat.combatants.map((c) => c.id)
          );
        }
      } else {
        combat = await Combat.create({ scene: null });
        await combat.activate();
      }

      const combatantDatas = [];
      for (const entry of this._entries) {
        const worldActor = await this._resolveOrCreateActor(entry);
        combatantDatas.push({ actorId: worldActor.id, hidden: false });
      }

      await combat.createEmbeddedDocuments("Combatant", combatantDatas);
      await combat.rollAll();

      ui.notifications.info(`Encounter Builder: ${this._entries.length} combatant(s) added to the Combat Tracker.`);

      const keepOpen = await this._promptKeepOpen();
      if (!keepOpen) this.close();

    } catch (err) {
      console.error(`${MODULE_ID} | Error adding to Combat Tracker:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console for details.");
    }
  }

  // ---------------------------------------------------------------------------
  // Push to Scene
  // ---------------------------------------------------------------------------

  async _onPushToScene() {
    if (this._entries.length === 0) {
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards before pushing to a scene.");
    }

    const sceneId = await this._promptPickScene();
    if (!sceneId) return;

    const scene = game.scenes.get(sceneId);
    if (!scene) {
      return ui.notifications.warn("Encounter Builder: Could not find that scene.");
    }

    ui.notifications.info("Encounter Builder: Pushing tokens to scene...");

    try {
      const gridSize = scene.grid.size ?? 100;
      const cx = Math.floor(scene.width  / 2 / gridSize) * gridSize;
      const cy = Math.floor(scene.height / 2 / gridSize) * gridSize;
      const positions = spiralPositions(this._entries.length, cx, cy, gridSize);

      const tokenDatas = await this._buildTokenDatas(this._entries, positions);
      await scene.createEmbeddedDocuments("Token", tokenDatas);

      ui.notifications.info(`Encounter Builder: ${this._entries.length} token(s) pushed to "${scene.name}".`);

      const keepOpen = await this._promptKeepOpen();
      if (!keepOpen) this.close();

    } catch (err) {
      console.error(`${MODULE_ID} | Error pushing to scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console for details.");
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — actor resolution and token building
  // (extracted to eliminate duplication between the three action methods)
  // ---------------------------------------------------------------------------

  /**
   * Resolves an entry to a world actor, importing from compendium if needed.
   * Falls back to creating a minimal stub actor.
   * @param {object} entry
   * @returns {Promise<Actor>}
   */
  async _resolveOrCreateActor(entry) {
    if (entry.actorUuid) {
      try {
        const sourceActor = await fromUuid(entry.actorUuid);
        if (sourceActor?.compendium) {
          return await game.actors.importFromCompendium(
            sourceActor.compendium,
            sourceActor.id,
            {},
            { keepId: false }
          );
        }
        // Already a world actor
        if (sourceActor && !sourceActor.compendium) return sourceActor;
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not import ${entry.name}:`, err);
      }
    }

    // Fallback: minimal stub
    const [fallback] = await Actor.createDocuments([{
      name: entry.name,
      type: entry.isHazard ? "hazard" : "npc",
    }]);
    return fallback;
  }

  /**
   * Builds an array of token data objects for a list of entries and positions.
   * @param {object[]} entries
   * @param {Array<{x: number, y: number}>} positions
   * @returns {Promise<object[]>}
   */
  async _buildTokenDatas(entries, positions) {
    const tokenDatas = [];
    for (let i = 0; i < entries.length; i++) {
      const worldActor = await this._resolveOrCreateActor(entries[i]);
      const tokenDoc   = await worldActor.getTokenDocument({
        x: positions[i].x,
        y: positions[i].y,
        hidden: false,
      });
      tokenDatas.push(tokenDoc.toObject());
    }
    return tokenDatas;
  }

  // ---------------------------------------------------------------------------
  // Entry manipulation
  // ---------------------------------------------------------------------------

  _setAdjustment(entryId, adjustment) {
    const entry = this._entries.find((e) => e.id === entryId);
    if (!entry) return;
    entry.adjustment = entry.adjustment === adjustment ? "none" : adjustment;
    this.render();
  }

  _removeEntry(entryId) {
    this._entries = this._entries.filter((e) => e.id !== entryId);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Party level resolution
  // ---------------------------------------------------------------------------

  _resolvePartyLevel(average, highest) {
    switch (this._partyLevelMode) {
      case "highest": return highest;
      case "manual":  return this._manualPartyLevel;
      default:        return average;
    }
  }

  _setPartyLevelMode(mode) {
    this._partyLevelMode = mode;
    game.settings.set(MODULE_ID, "partyLevelMode", mode);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Budget bar builder
  // ---------------------------------------------------------------------------

  _buildBudgetBars(totalXP, budgets) {
    const maxXP = Math.max(budgets.extreme * 1.2, totalXP * 1.1, 10);
    return [
      { tier: "trivial",  label: "Trivial",  xp: budgets.trivial,  pct: (budgets.trivial  / maxXP) * 100, color: "#aaaaaa", isCurrent: false },
      { tier: "low",      label: "Low",      xp: budgets.low,      pct: (budgets.low      / maxXP) * 100, color: "#4caf50", isCurrent: false },
      { tier: "moderate", label: "Moderate", xp: budgets.moderate, pct: (budgets.moderate / maxXP) * 100, color: "#2196f3", isCurrent: false },
      { tier: "severe",   label: "Severe",   xp: budgets.severe,   pct: (budgets.severe   / maxXP) * 100, color: "#ff9800", isCurrent: false },
      { tier: "extreme",  label: "Extreme",  xp: budgets.extreme,  pct: (budgets.extreme  / maxXP) * 100, color: "#f44336", isCurrent: false },
      { tier: "current",  label: "Current",  xp: totalXP,          pct: (totalXP          / maxXP) * 100, color: "#ffffff", isCurrent: true  },
    ];
  }

  // ---------------------------------------------------------------------------
  // Dialogs — updated to use foundry.applications.api.DialogV2
  // ---------------------------------------------------------------------------

  async _promptForSceneName() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Create Encounter Scene" },
        content: `
          <p>Enter a name for the new scene:</p>
          <div style="margin: 8px 0;">
            <input type="text"
                   id="scene-name-input"
                   placeholder="e.g. Goblin Ambush"
                   autofocus
                   style="width: 100%; box-sizing: border-box;" />
          </div>
        `,
        buttons: [
          {
            label: "Create Scene",
            default: true,
            action: "confirm",
            callback: (event, button, dialog) => {
              const val = dialog.element.querySelector("#scene-name-input")?.value?.trim();
              resolve(val || "Unnamed Encounter");
            },
          },
          {
            label: "Cancel",
            action: "cancel",
            callback: () => resolve(null),
          },
        ],
      }).render(true);
    });
  }

  async _promptForLevel(actorName) {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Set Creature Level" },
        content: `
          <p><strong>${actorName}</strong> doesn't have a detectable level.</p>
          <p>Enter its level manually:</p>
          <div style="margin: 8px 0;">
            <input type="number" id="manual-level-input" min="-1" max="25" value="1"
              autofocus style="width: 80px; text-align: center;" />
          </div>
        `,
        buttons: [
          {
            label: "Add to Encounter",
            default: true,
            action: "confirm",
            callback: (event, button, dialog) => {
              const val = parseInt(dialog.element.querySelector("#manual-level-input")?.value, 10);
              resolve(isNaN(val) ? 1 : val);
            },
          },
          {
            label: "Cancel",
            action: "cancel",
            callback: () => resolve(null),
          },
        ],
      }).render(true);
    });
  }

  async _promptKeepOpen() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Scene Created" },
        content: `<p>Scene created successfully! Would you like to keep the Encounter Builder open?</p>`,
        buttons: [
          {
            label: "Keep Open",
            default: true,
            action: "keep",
            callback: () => resolve(true),
          },
          {
            label: "Close Builder",
            action: "close",
            callback: () => resolve(false),
          },
        ],
      }).render(true);
    });
  }

  async _promptReplaceOrAppend() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Active Combat Detected" },
        content: `<p>There is already an active combat. What would you like to do?</p>`,
        buttons: [
          {
            label: "Add to Existing",
            default: true,
            action: "append",
            callback: () => resolve(false),
          },
          {
            label: "Clear and Replace",
            action: "replace",
            callback: () => resolve(true),
          },
          {
            label: "Cancel",
            action: "cancel",
            callback: () => resolve(null),
          },
        ],
      }).render(true);
    });
  }

  async _promptPickScene() {
    return new Promise((resolve) => {
      const scenes = game.scenes.contents;
      if (scenes.length === 0) {
        ui.notifications.warn("Encounter Builder: No scenes found in this world.");
        resolve(null);
        return;
      }

      const options = scenes
        .map((s) => `<option value="${s.id}">${s.name}</option>`)
        .join("");

      new foundry.applications.api.DialogV2({
        window: { title: "Push to Scene" },
        content: `
          <p>Select a scene to push tokens to:</p>
          <div style="margin: 8px 0;">
            <select id="scene-pick-select" style="width: 100%;">
              ${options}
            </select>
          </div>
        `,
        buttons: [
          {
            label: "Push Tokens",
            default: true,
            action: "confirm",
            callback: (event, button, dialog) => {
              resolve(dialog.element.querySelector("#scene-pick-select")?.value ?? null);
            },
          },
          {
            label: "Cancel",
            action: "cancel",
            callback: () => resolve(null),
          },
        ],
      }).render(true);
    });
  }
}

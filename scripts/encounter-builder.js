/**
 * encounter-builder.js
 * The main ApplicationV2 class for the PF2e Encounter Builder.
 * v0.4.0 — adds Suggest Encounter (random) and Generate Encounter (themed).
 */

import { MODULE_ID } from "./main.js";
import {
  computePartyLevels,
  summarizeEncounter,
  getBudgets,
} from "./xp-calculator.js";
import { generateEncounter } from "./encounter-generator.js";

// ---------------------------------------------------------------------------
// Helpers (unchanged from v0.3.0)
// ---------------------------------------------------------------------------

function getPartyLevels() {
  return game.actors
    .filter((a) => a.type === "character" && a.hasPlayerOwner && !a.isToken)
    .map((a) => a.system.details.level.value ?? 1);
}

function getActorLevel(actor) {
  return (
    actor.system?.details?.level?.value ??
    actor.system?.level?.value ??
    null
  );
}

function isHazardActor(actor) { return actor.type === "hazard"; }
function isComplexHazard(actor) { return actor.system?.details?.isComplex ?? false; }
function uid() { return Math.random().toString(36).slice(2, 9); }

function spiralPositions(count, cx, cy, gridSize) {
  const positions = [];
  positions.push({ x: cx, y: cy });
  if (count <= 1) return positions;
  let x = 0, y = 0, dx = 1, dy = 0, steps = 1, stepCount = 0, turns = 0;
  while (positions.length < count) {
    x += dx; y += dy;
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
    this._entries           = [];
    this._partyLevelMode    = game.settings.get(MODULE_ID, "partyLevelMode");
    this._manualPartyLevel  = game.settings.get(MODULE_ID, "manualPartyLevel");
    this._manualPartySize   = game.settings.get(MODULE_ID, "manualPartySize");
    this._overridePartySize = game.settings.get(MODULE_ID, "overridePartySize");
    this._hazardsExpanded   = game.settings.get(MODULE_ID, "hazardsExpanded");

    // Generation state
    this._generationPending = null; // { entries, totalXP, budget, tier } | null
    this._generating        = false;
  }

  // ---------------------------------------------------------------------------
  // ApplicationV2 configuration
  // ---------------------------------------------------------------------------

  static DEFAULT_OPTIONS = {
    id: "pf2e-encounter-builder",
    window: { title: "Encounter Builder", resizable: true },
    position: { width: 520, height: 680 },
    classes: ["pf2e-encounter-builder"],
  };

  static PARTS = {
    main: {
      template: "modules/pf2e-encounter-builder/templates/encounter-builder.hbs",
    },
  };

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  async _prepareContext(options) {
    const rawLevels = getPartyLevels();
    const { average, highest } = computePartyLevels(rawLevels);
    const activePartyLevel  = this._resolvePartyLevel(average, highest);
    const detectedSize      = rawLevels.length || 4;
    const activePartySize   = this._overridePartySize ? this._manualPartySize : detectedSize;
    const summary           = summarizeEncounter(this._entries, activePartyLevel, activePartySize);
    const budgetBars        = this._buildBudgetBars(summary.totalXP, summary.budgets);

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
      overridePartySize:     this._overridePartySize,
      manualPartySize:       this._manualPartySize,
      averageLevel:          average,
      highestLevel:          highest,
      manualPartyLevel:      this._manualPartyLevel,
      partyLevelMode:        this._partyLevelMode,
      activePartyLevel,
      partyLevelModeAverage: this._partyLevelMode === "average",
      partyLevelModeHighest: this._partyLevelMode === "highest",
      partyLevelModeManual:  this._partyLevelMode === "manual",
      creatures,
      hazards,
      totalXP:        summary.totalXP,
      difficulty:     summary.difficulty,
      budgets:        summary.budgets,
      budgetBars,
      hazardsExpanded:  this._hazardsExpanded,
      hasCreatures:     creatures.length > 0,
      hasHazards:       hazards.length > 0,
      hasEntries:       this._entries.length > 0,
      // Generation state
      generating:       this._generating,
      generationPending: this._generationPending
        ? {
            ...this._generationPending,
            tierLabel: this._tierLabel(this._generationPending.tier),
          }
        : null,
    };
  }

  _tierLabel(tier) {
    return { trivial: "Trivial", low: "Low", moderate: "Moderate", severe: "Severe", extreme: "Extreme" }[tier] ?? tier;
  }

  // ---------------------------------------------------------------------------
  // _onRender
  // ---------------------------------------------------------------------------

  _onRender(context, options) {
    const html = this.element;

    // Party level
    html.querySelectorAll(".party-level-mode-btn").forEach((btn) =>
      btn.addEventListener("click", () => this._setPartyLevelMode(btn.dataset.mode))
    );
    html.querySelector(".manual-party-level")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 20) {
        this._manualPartyLevel = val;
        game.settings.set(MODULE_ID, "manualPartyLevel", val);
        this.render();
      }
    });

    // Party size
    html.querySelector(".party-size-override-toggle")?.addEventListener("change", (e) => {
      this._overridePartySize = e.target.checked;
      game.settings.set(MODULE_ID, "overridePartySize", this._overridePartySize);
      this.render();
    });
    html.querySelector(".manual-party-size")?.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) {
        this._manualPartySize = val;
        game.settings.set(MODULE_ID, "manualPartySize", val);
        this.render();
      }
    });

    // Entry controls
    html.querySelectorAll(".adjustment-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (id) this._setAdjustment(id, btn.dataset.adjustment);
      })
    );
    html.querySelectorAll(".remove-entry-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (id) this._removeEntry(id);
      })
    );
    html.querySelector(".clear-creatures-btn")?.addEventListener("click", () => {
      this._entries = this._entries.filter((e) => e.isHazard);
      this.render();
    });
    html.querySelector(".clear-hazards-btn")?.addEventListener("click", () => {
      this._entries = this._entries.filter((e) => !e.isHazard);
      this.render();
    });

    // Hazards toggle
    html.querySelector(".hazards-toggle-btn")?.addEventListener("click", () => {
      this._hazardsExpanded = !this._hazardsExpanded;
      game.settings.set(MODULE_ID, "hazardsExpanded", this._hazardsExpanded);
      this.render();
    });

    // Scene / tracker buttons
    html.querySelector(".create-scene-btn")?.addEventListener("click",   () => this._onCreateScene());
    html.querySelector(".add-to-tracker-btn")?.addEventListener("click", () => this._onAddToTracker());
    html.querySelector(".push-to-scene-btn")?.addEventListener("click",  () => this._onPushToScene());

    // Generation buttons
    html.querySelector(".suggest-encounter-btn")?.addEventListener("click", () => this._onSuggestEncounter());
    html.querySelector(".generate-encounter-btn")?.addEventListener("click", () => this._onGenerateEncounter());

    // Pending suggestion controls
    html.querySelector(".gen-accept-btn")?.addEventListener("click",   () => this._acceptSuggestion());
    html.querySelector(".gen-reroll-btn")?.addEventListener("click",   () => this._rerollSuggestion());
    html.querySelector(".gen-discard-btn")?.addEventListener("click",  () => this._discardSuggestion());

    // Drop zones
    this._activateDropZone(html.querySelector(".encounter-drop-zone"));
    this._activateDropZone(html.querySelector(".hazard-drop-zone"));
  }

  // ---------------------------------------------------------------------------
  // Drop zones
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
      if (data.uuid)            actor = await fromUuid(data.uuid);
      else if (data.pack && data.id) actor = await game.packs.get(data.pack)?.getDocument(data.id);
      else if (data.id)         actor = game.actors.get(data.id);
    } catch (err) {
      console.error(`${MODULE_ID} | Error resolving dropped actor:`, err);
    }
    if (!actor) return ui.notifications.warn("Encounter Builder: Could not find that actor.");

    let level = getActorLevel(actor);
    if (level === null) {
      level = await this._promptForLevel(actor.name);
      if (level === null) return;
    }
    const hazard  = isHazardActor(actor);
    const complex = hazard ? isComplexHazard(actor) : false;
    this._entries.push({
      id: uid(), name: actor.name, baseLevel: level,
      adjustment: "none", isHazard: hazard, isComplex: complex,
      actorUuid: actor.uuid ?? null,
    });
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Generation — Suggest (random)
  // ---------------------------------------------------------------------------

  async _onSuggestEncounter() {
    await this._runGeneration({ theme: "", spice: this._pickRandomSpice() });
  }

  _pickRandomSpice() {
    return Math.ceil(Math.random() * 3); // 1, 2, or 3
  }

  // ---------------------------------------------------------------------------
  // Generation — Themed
  // ---------------------------------------------------------------------------

  async _onGenerateEncounter() {
    const params = await this._promptGenerationParams();
    if (!params) return;
    await this._runGeneration(params);
  }

  /**
   * Shared runner for both generation modes.
   * Shows progress notifications, then stores the result as a pending suggestion.
   */
  async _runGeneration({ theme, spice }) {
    if (this._generating) return;
    this._generating = true;
    this._generationPending = null;
    this.render();

    const rawLevels       = getPartyLevels();
    const { average, highest } = computePartyLevels(rawLevels);
    const partyLevel      = this._resolvePartyLevel(average, highest);
    const partySize       = this._overridePartySize
      ? this._manualPartySize
      : (rawLevels.length || 4);

    let notif = ui.notifications.info("Encounter Builder: Searching compendiums…", { permanent: true });

    try {
      const result = await generateEncounter({
        theme,
        spice,
        partyLevel,
        partySize,
        onProgress: (msg) => {
          // Replace the permanent notification text in place
          notif?.remove?.();
          notif = ui.notifications.info(`Encounter Builder: ${msg}`, { permanent: true });
        },
      });

      notif?.remove?.();

      if (!result || result.entries.length === 0) {
        ui.notifications.warn(
          theme
            ? `Encounter Builder: No creatures found matching "${theme}". Try different terms.`
            : "Encounter Builder: No suitable creatures found in your compendiums."
        );
        this._generating = false;
        this.render();
        return;
      }

      this._generationPending = result;

    } catch (err) {
      notif?.remove?.();
      console.error(`${MODULE_ID} | Generation error:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong during generation. Check the console.");
    }

    this._generating = false;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Pending suggestion actions
  // ---------------------------------------------------------------------------

  /** Accept — merge suggestion into the main entry list */
  _acceptSuggestion() {
    if (!this._generationPending) return;
    this._entries.push(...this._generationPending.entries);
    this._generationPending = null;
    this.render();
  }

  /** Reroll — run the same generation again with the same params */
  async _rerollSuggestion() {
    if (!this._generationPending) return;
    // Store tier so we can re-use it; map tier back to spice
    const tierToSpice = { low: 1, moderate: 2, severe: 3 };
    const spice = tierToSpice[this._generationPending.tier] ?? 2;
    const theme = this._generationPending.theme ?? "";
    this._generationPending = null;
    await this._runGeneration({ theme, spice });
  }

  /** Discard — throw away the suggestion */
  _discardSuggestion() {
    this._generationPending = null;
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
    ui.notifications.info("Encounter Builder: Creating scene…");
    try {
      const gridSize = 100, sceneWidth = 4000, sceneHeight = 3000;
      const [scene] = await Scene.createDocuments([{
        name: sceneName, width: sceneWidth, height: sceneHeight,
        grid: { type: 1, size: gridSize }, padding: 0.25,
        backgroundColor: "#000000", tokenVision: false,
      }]);
      const cx = Math.floor(sceneWidth  / 2 / gridSize) * gridSize;
      const cy = Math.floor(sceneHeight / 2 / gridSize) * gridSize;
      const positions  = spiralPositions(this._entries.length, cx, cy, gridSize);
      const tokenDatas = await this._buildTokenDatas(this._entries, positions);
      await scene.createEmbeddedDocuments("Token", tokenDatas);
      await scene.activate();
      ui.notifications.info(`Encounter Builder: Scene "${sceneName}" created with ${this._entries.length} token(s).`);
      const keepOpen = await this._promptKeepOpen();
      if (!keepOpen) this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Error creating scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
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
          await combat.deleteEmbeddedDocuments("Combatant", combat.combatants.map((c) => c.id));
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
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
    }
  }

  // ---------------------------------------------------------------------------
  // Push to Scene
  // ---------------------------------------------------------------------------

  async _onPushToScene() {
    if (this._entries.length === 0) {
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards first.");
    }
    const sceneId = await this._promptPickScene();
    if (!sceneId) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return ui.notifications.warn("Encounter Builder: Could not find that scene.");
    ui.notifications.info("Encounter Builder: Pushing tokens to scene…");
    try {
      const gridSize = scene.grid.size ?? 100;
      const cx = Math.floor(scene.width  / 2 / gridSize) * gridSize;
      const cy = Math.floor(scene.height / 2 / gridSize) * gridSize;
      const positions  = spiralPositions(this._entries.length, cx, cy, gridSize);
      const tokenDatas = await this._buildTokenDatas(this._entries, positions);
      await scene.createEmbeddedDocuments("Token", tokenDatas);
      ui.notifications.info(`Encounter Builder: ${this._entries.length} token(s) pushed to "${scene.name}".`);
      const keepOpen = await this._promptKeepOpen();
      if (!keepOpen) this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Error pushing to scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
    }
  }

  // ---------------------------------------------------------------------------
  // Shared actor helpers
  // ---------------------------------------------------------------------------

  async _resolveOrCreateActor(entry) {
    if (entry.actorUuid) {
      try {
        const sourceActor = await fromUuid(entry.actorUuid);
        if (sourceActor?.compendium) {
          return await game.actors.importFromCompendium(
            sourceActor.compendium, sourceActor.id, {}, { keepId: false }
          );
        }
        if (sourceActor && !sourceActor.compendium) return sourceActor;
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not import ${entry.name}:`, err);
      }
    }
    const [fallback] = await Actor.createDocuments([{
      name: entry.name, type: entry.isHazard ? "hazard" : "npc",
    }]);
    return fallback;
  }

  async _buildTokenDatas(entries, positions) {
    const tokenDatas = [];
    for (let i = 0; i < entries.length; i++) {
      const worldActor = await this._resolveOrCreateActor(entries[i]);
      const tokenDoc   = await worldActor.getTokenDocument({
        x: positions[i].x, y: positions[i].y, hidden: false,
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
  // Dialogs
  // ---------------------------------------------------------------------------

  async _promptGenerationParams() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Generate Encounter" },
        content: `
          <div style="display:flex; flex-direction:column; gap:12px; padding: 4px 0;">
            <div>
              <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#c8a45e; text-transform:uppercase; letter-spacing:0.06em;">
                Theme / Traits
              </label>
              <input type="text"
                     id="gen-theme-input"
                     placeholder="e.g. undead crypt, fey forest, fire giant"
                     autofocus
                     style="width:100%; box-sizing:border-box;" />
              <p style="font-size:0.72rem; color:#b0a090; margin:4px 0 0;">
                Leave blank for a fully random encounter.
              </p>
            </div>
            <div>
              <label style="display:block; font-size:0.8rem; margin-bottom:6px; color:#c8a45e; text-transform:uppercase; letter-spacing:0.06em;">
                How spicy do you want this? 🌶
              </label>
              <div style="display:flex; gap:8px;">
                <label style="flex:1; text-align:center; cursor:pointer;">
                  <input type="radio" name="spice" value="1" style="display:none;" />
                  <div class="spice-btn" data-spice="1"
                       style="border:1px solid rgba(255,255,255,0.2); border-radius:4px; padding:8px 4px; font-size:0.8rem; transition:all 0.15s;">
                    🌶<br><strong>Mild</strong><br><span style="font-size:0.7rem; color:#b0a090;">Low</span>
                  </div>
                </label>
                <label style="flex:1; text-align:center; cursor:pointer;">
                  <input type="radio" name="spice" value="2" checked style="display:none;" />
                  <div class="spice-btn" data-spice="2"
                       style="border:1px solid rgba(200,164,94,0.6); border-radius:4px; padding:8px 4px; font-size:0.8rem; background:rgba(200,164,94,0.15); transition:all 0.15s;">
                    🌶🌶<br><strong>Medium</strong><br><span style="font-size:0.7rem; color:#b0a090;">Moderate</span>
                  </div>
                </label>
                <label style="flex:1; text-align:center; cursor:pointer;">
                  <input type="radio" name="spice" value="3" style="display:none;" />
                  <div class="spice-btn" data-spice="3"
                       style="border:1px solid rgba(255,255,255,0.2); border-radius:4px; padding:8px 4px; font-size:0.8rem; transition:all 0.15s;">
                    🌶🌶🌶<br><strong>Hot</strong><br><span style="font-size:0.7rem; color:#b0a090;">Severe</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <style>
            /* Spice button selection highlight wired via JS below */
          </style>
        `,
        render: (event, dialog) => {
          // Wire up spice button visual selection
          const btns = dialog.element.querySelectorAll(".spice-btn");
          const radios = dialog.element.querySelectorAll("input[name='spice']");
          btns.forEach((btn) => {
            btn.closest("label").addEventListener("click", () => {
              btns.forEach((b) => {
                b.style.borderColor = "rgba(255,255,255,0.2)";
                b.style.background  = "transparent";
              });
              btn.style.borderColor = "rgba(200,164,94,0.6)";
              btn.style.background  = "rgba(200,164,94,0.15)";
            });
          });
        },
        buttons: [
          {
            label: "Generate",
            default: true,
            action: "confirm",
            callback: (event, button, dialog) => {
              const theme  = dialog.element.querySelector("#gen-theme-input")?.value?.trim() ?? "";
              const spiceR = dialog.element.querySelector("input[name='spice']:checked");
              const spice  = spiceR ? parseInt(spiceR.value, 10) : 2;
              resolve({ theme, spice });
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

  async _promptForSceneName() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Create Encounter Scene" },
        content: `
          <p>Enter a name for the new scene:</p>
          <div style="margin: 8px 0;">
            <input type="text" id="scene-name-input" placeholder="e.g. Goblin Ambush"
                   autofocus style="width:100%; box-sizing:border-box;" />
          </div>
        `,
        buttons: [
          {
            label: "Create Scene", default: true, action: "confirm",
            callback: (event, button, dialog) => {
              const val = dialog.element.querySelector("#scene-name-input")?.value?.trim();
              resolve(val || "Unnamed Encounter");
            },
          },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
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
              autofocus style="width:80px; text-align:center;" />
          </div>
        `,
        buttons: [
          {
            label: "Add to Encounter", default: true, action: "confirm",
            callback: (event, button, dialog) => {
              const val = parseInt(dialog.element.querySelector("#manual-level-input")?.value, 10);
              resolve(isNaN(val) ? 1 : val);
            },
          },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
        ],
      }).render(true);
    });
  }

  async _promptKeepOpen() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Done!" },
        content: `<p>Would you like to keep the Encounter Builder open?</p>`,
        buttons: [
          { label: "Keep Open",     default: true, action: "keep",  callback: () => resolve(true) },
          { label: "Close Builder", action: "close", callback: () => resolve(false) },
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
          { label: "Add to Existing", default: true, action: "append",  callback: () => resolve(false) },
          { label: "Clear and Replace",              action: "replace", callback: () => resolve(true) },
          { label: "Cancel",                         action: "cancel",  callback: () => resolve(null) },
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
      const options = scenes.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
      new foundry.applications.api.DialogV2({
        window: { title: "Push to Scene" },
        content: `
          <p>Select a scene to push tokens to:</p>
          <div style="margin: 8px 0;">
            <select id="scene-pick-select" style="width:100%;">${options}</select>
          </div>
        `,
        buttons: [
          {
            label: "Push Tokens", default: true, action: "confirm",
            callback: (event, button, dialog) =>
              resolve(dialog.element.querySelector("#scene-pick-select")?.value ?? null),
          },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
        ],
      }).render(true);
    });
  }
}

/**
 * encounter-builder.js
 * v0.5.0 — adds session-cached compendium index and in-window compendium selector.
 */

import { MODULE_ID } from "./main.js";
import { computePartyLevels, summarizeEncounter } from "./xp-calculator.js";
import { buildIndex, generateEncounter, getAllCreatureCompendiums } from "./encounter-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPartyLevels() {
  return game.actors
    .filter((a) => a.type === "character" && a.hasPlayerOwner && !a.isToken)
    .map((a) => a.system.details.level.value ?? 1);
}

function getActorLevel(actor) {
  return actor.system?.details?.level?.value ?? actor.system?.level?.value ?? null;
}

function isHazardActor(actor) { return actor.type === "hazard"; }
function isComplexHazard(actor) { return actor.system?.details?.isComplex ?? false; }
function uid() { return Math.random().toString(36).slice(2, 9); }

function spiralPositions(count, cx, cy, gridSize) {
  const positions = [{ x: cx, y: cy }];
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
// EncounterBuilder
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
    this._generationPending = null;
    this._generating        = false;

    // Session cache
    this._index          = null;   // the built actor index
    this._indexBuiltAt   = null;   // Date timestamp
    this._indexing       = false;  // true while buildIndex() is running
  }

  // ---------------------------------------------------------------------------
  // ApplicationV2 configuration
  // ---------------------------------------------------------------------------

  static DEFAULT_OPTIONS = {
    id: "pf2e-encounter-builder",
    window: { title: "Encounter Builder", resizable: true },
    position: { width: 520, height: 720 },
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
    const rawLevels       = getPartyLevels();
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

    // Index status for the UI
    let indexAge = null;
    if (this._indexBuiltAt) {
      const mins = Math.floor((Date.now() - this._indexBuiltAt) / 60000);
      indexAge = mins < 1 ? "just now" : `${mins}m ago`;
    }

    // How many compendiums are selected
    const selectedCompendiums = this._getSelectedCompendiumIds();
    const allPacks = getAllCreatureCompendiums();
    const selectedCount = selectedCompendiums.length === 0
      ? allPacks.length
      : selectedCompendiums.length;

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
      // Generation
      generating:        this._generating || this._indexing,
      generationPending: this._generationPending
        ? { ...this._generationPending, tierLabel: this._tierLabel(this._generationPending.tier) }
        : null,
      // Index status
      indexBuilt:    !!this._index,
      indexAge,
      indexActorCount: this._index?.length ?? 0,
      selectedCompendiumCount: selectedCount,
      totalCompendiumCount:    allPacks.length,
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
    html.querySelector(".suggest-encounter-btn")?.addEventListener("click",  () => this._onSuggestEncounter());
    html.querySelector(".generate-encounter-btn")?.addEventListener("click", () => this._onGenerateEncounter());

    // Index controls
    html.querySelector(".rebuild-index-btn")?.addEventListener("click",       () => this._buildIndexWithProgress());
    html.querySelector(".configure-compendiums-btn")?.addEventListener("click", () => this._onConfigureCompendiums());

    // Pending suggestion controls
    html.querySelector(".gen-accept-btn")?.addEventListener("click",  () => this._acceptSuggestion());
    html.querySelector(".gen-reroll-btn")?.addEventListener("click",  () => this._rerollSuggestion());
    html.querySelector(".gen-discard-btn")?.addEventListener("click", () => this._discardSuggestion());

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
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
    catch { return ui.notifications.warn("Encounter Builder: Could not read dropped data."); }

    if (data.type !== "Actor")
      return ui.notifications.warn("Encounter Builder: Only actors can be dropped here.");

    let actor;
    try {
      if (data.uuid)             actor = await fromUuid(data.uuid);
      else if (data.pack && data.id) actor = await game.packs.get(data.pack)?.getDocument(data.id);
      else if (data.id)          actor = game.actors.get(data.id);
    } catch (err) { console.error(`${MODULE_ID} | Error resolving dropped actor:`, err); }

    if (!actor) return ui.notifications.warn("Encounter Builder: Could not find that actor.");

    let level = getActorLevel(actor);
    if (level === null) { level = await this._promptForLevel(actor.name); if (level === null) return; }

    const hazard  = isHazardActor(actor);
    this._entries.push({
      id: uid(), name: actor.name, baseLevel: level,
      adjustment: "none", isHazard: hazard,
      isComplex: hazard ? isComplexHazard(actor) : false,
      actorUuid: actor.uuid ?? null,
    });
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  _getSelectedCompendiumIds() {
    try { return game.settings.get(MODULE_ID, "selectedCompendiums") ?? []; }
    catch { return []; }
  }

  /**
   * Builds (or rebuilds) the session index.
   * Shows progress notifications while running.
   * Invalidates any existing pending suggestion.
   */
  async _buildIndexWithProgress() {
    if (this._indexing) return;
    this._indexing       = true;
    this._index          = null;
    this._indexBuiltAt   = null;
    this._generationPending = null;
    this.render();

    let notif = ui.notifications.info("Encounter Builder: Building compendium index…", { permanent: true });

    try {
      this._index = await buildIndex((msg) => {
        notif?.remove?.();
        notif = ui.notifications.info(`Encounter Builder: ${msg}`, { permanent: true });
      });
      this._indexBuiltAt = Date.now();
      notif?.remove?.();
      ui.notifications.info(
        `Encounter Builder: Index ready — ${this._index.length} creatures indexed.`
      );
    } catch (err) {
      notif?.remove?.();
      console.error(`${MODULE_ID} | Index build error:`, err);
      ui.notifications.error("Encounter Builder: Failed to build index. Check the console.");
    }

    this._indexing = false;
    this.render();
  }

  /**
   * Ensures the index exists, building it if needed.
   * Called automatically before generation.
   */
  async _ensureIndex() {
    if (this._index) return true;
    await this._buildIndexWithProgress();
    return !!this._index;
  }

  // ---------------------------------------------------------------------------
  // Compendium selector
  // ---------------------------------------------------------------------------

  async _onConfigureCompendiums() {
    const allPacks      = getAllCreatureCompendiums();
    const selectedIds   = new Set(this._getSelectedCompendiumIds());
    // Empty selectedIds means "all" — treat as all selected in the UI
    const allSelected   = selectedIds.size === 0;

    const rows = allPacks.map((pack) => {
      const checked = allSelected || selectedIds.has(pack.collection);
      return `
        <label class="eb-compendium-row">
          <input type="checkbox"
                 class="eb-compendium-check"
                 value="${pack.collection}"
                 ${checked ? "checked" : ""} />
          <span class="eb-compendium-name">${pack.metadata.label ?? pack.collection}</span>
          <span class="eb-compendium-source">${pack.metadata.packageTitle ?? pack.metadata.packageName ?? ""}</span>
        </label>
      `;
    }).join("");

    await new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Configure Generation Compendiums" },
        content: `
          <div class="eb-compendium-selector">
            <p class="eb-compendium-hint">
              Choose which compendiums the encounter generator searches.
              Fewer compendiums = faster generation.
            </p>
            <div class="eb-compendium-toolbar">
              <button type="button" class="eb-check-all eb-small-btn">Select All</button>
              <button type="button" class="eb-uncheck-all eb-small-btn">Deselect All</button>
            </div>
            <div class="eb-compendium-list">
              ${rows}
            </div>
          </div>
        `,
        render: (event, dialog) => {
          dialog.element.querySelector(".eb-check-all")?.addEventListener("click", () => {
            dialog.element.querySelectorAll(".eb-compendium-check")
              .forEach((cb) => cb.checked = true);
          });
          dialog.element.querySelector(".eb-uncheck-all")?.addEventListener("click", () => {
            dialog.element.querySelectorAll(".eb-compendium-check")
              .forEach((cb) => cb.checked = false);
          });
        },
        buttons: [
          {
            label: "Save",
            default: true,
            action: "save",
            callback: async (event, button, dialog) => {
              const checked = [...dialog.element.querySelectorAll(".eb-compendium-check:checked")]
                .map((cb) => cb.value);

              // If all are checked, store empty array (= "use all", avoids stale list)
              const toStore = checked.length === allPacks.length ? [] : checked;
              await game.settings.set(MODULE_ID, "selectedCompendiums", toStore);

              // Invalidate the index — selection changed
              this._index        = null;
              this._indexBuiltAt = null;

              ui.notifications.info(
                toStore.length === 0
                  ? "Encounter Builder: Using all compendiums."
                  : `Encounter Builder: ${toStore.length} compendium(s) selected. Index cleared — will rebuild on next generation.`
              );
              this.render();
              resolve();
            },
          },
          {
            label: "Cancel",
            action: "cancel",
            callback: () => resolve(),
          },
        ],
      }).render(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  async _onSuggestEncounter() {
    await this._runGeneration({ theme: "", spice: this._pickRandomSpice() });
  }

  _pickRandomSpice() { return Math.ceil(Math.random() * 3); }

  async _onGenerateEncounter() {
    const params = await this._promptGenerationParams();
    if (!params) return;
    await this._runGeneration(params);
  }

  async _runGeneration({ theme, spice }) {
    if (this._generating || this._indexing) return;

    // Build the index first if needed
    const ready = await this._ensureIndex();
    if (!ready) return;

    this._generating        = true;
    this._generationPending = null;
    this.render();

    try {
      const rawLevels     = getPartyLevels();
      const { average, highest } = computePartyLevels(rawLevels);
      const partyLevel    = this._resolvePartyLevel(average, highest);
      const partySize     = this._overridePartySize
        ? this._manualPartySize
        : (rawLevels.length || 4);

      // generateEncounter is now synchronous — all I/O was done during indexing
      const result = generateEncounter({ index: this._index, theme, spice, partyLevel, partySize });

      if (!result || result.entries.length === 0) {
        ui.notifications.warn(
          theme
            ? `Encounter Builder: No creatures found matching "${theme}". Try different terms.`
            : "Encounter Builder: No suitable creatures found in the index."
        );
      } else {
        this._generationPending = { ...result, theme };
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Generation error:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong during generation. Check the console.");
    }

    this._generating = false;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Pending suggestion actions
  // ---------------------------------------------------------------------------

  _acceptSuggestion() {
    if (!this._generationPending) return;
    this._entries.push(...this._generationPending.entries);
    this._generationPending = null;
    this.render();
  }

  async _rerollSuggestion() {
    if (!this._generationPending) return;
    const tierToSpice = { low: 1, moderate: 2, severe: 3 };
    const spice = tierToSpice[this._generationPending.tier] ?? 2;
    const theme = this._generationPending.theme ?? "";
    this._generationPending = null;
    await this._runGeneration({ theme, spice });
  }

  _discardSuggestion() {
    this._generationPending = null;
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Scene / tracker actions
  // ---------------------------------------------------------------------------

  async _onCreateScene() {
    if (this._entries.length === 0)
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards first.");
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
      const tokenDatas = await this._buildTokenDatas(
        this._entries, spiralPositions(this._entries.length, cx, cy, gridSize)
      );
      await scene.createEmbeddedDocuments("Token", tokenDatas);
      await scene.activate();
      ui.notifications.info(`Encounter Builder: Scene "${sceneName}" created.`);
      if (!await this._promptKeepOpen()) this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Error creating scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
    }
  }

  async _onAddToTracker() {
    if (this._entries.length === 0)
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards first.");
    try {
      let combat = game.combat;
      if (combat) {
        const replace = await this._promptReplaceOrAppend();
        if (replace === null) return;
        if (replace)
          await combat.deleteEmbeddedDocuments("Combatant", combat.combatants.map((c) => c.id));
      } else {
        combat = await Combat.create({ scene: null });
        await combat.activate();
      }
      const datas = [];
      for (const entry of this._entries) {
        const actor = await this._resolveOrCreateActor(entry);
        datas.push({ actorId: actor.id, hidden: false });
      }
      await combat.createEmbeddedDocuments("Combatant", datas);
      await combat.rollAll();
      ui.notifications.info(`Encounter Builder: ${this._entries.length} combatant(s) added.`);
      if (!await this._promptKeepOpen()) this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Error adding to tracker:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
    }
  }

  async _onPushToScene() {
    if (this._entries.length === 0)
      return ui.notifications.warn("Encounter Builder: Add some creatures or hazards first.");
    const sceneId = await this._promptPickScene();
    if (!sceneId) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) return ui.notifications.warn("Encounter Builder: Could not find that scene.");
    ui.notifications.info("Encounter Builder: Pushing tokens…");
    try {
      const gridSize = scene.grid.size ?? 100;
      const cx = Math.floor(scene.width  / 2 / gridSize) * gridSize;
      const cy = Math.floor(scene.height / 2 / gridSize) * gridSize;
      const tokenDatas = await this._buildTokenDatas(
        this._entries, spiralPositions(this._entries.length, cx, cy, gridSize)
      );
      await scene.createEmbeddedDocuments("Token", tokenDatas);
      ui.notifications.info(`Encounter Builder: ${this._entries.length} token(s) pushed to "${scene.name}".`);
      if (!await this._promptKeepOpen()) this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Error pushing to scene:`, err);
      ui.notifications.error("Encounter Builder: Something went wrong. Check the console.");
    }
  }

  // ---------------------------------------------------------------------------
  // Actor helpers
  // ---------------------------------------------------------------------------

  async _resolveOrCreateActor(entry) {
    if (entry.actorUuid) {
      try {
        const src = await fromUuid(entry.actorUuid);
        if (src?.compendium)
          return await game.actors.importFromCompendium(src.compendium, src.id, {}, { keepId: false });
        if (src && !src.compendium) return src;
      } catch (err) { console.warn(`${MODULE_ID} | Could not import ${entry.name}:`, err); }
    }
    const [fallback] = await Actor.createDocuments([{
      name: entry.name, type: entry.isHazard ? "hazard" : "npc",
    }]);
    return fallback;
  }

  async _buildTokenDatas(entries, positions) {
    const datas = [];
    for (let i = 0; i < entries.length; i++) {
      const actor    = await this._resolveOrCreateActor(entries[i]);
      const tokenDoc = await actor.getTokenDocument({ x: positions[i].x, y: positions[i].y, hidden: false });
      datas.push(tokenDoc.toObject());
    }
    return datas;
  }

  // ---------------------------------------------------------------------------
  // Entry manipulation
  // ---------------------------------------------------------------------------

  _setAdjustment(entryId, adj) {
    const e = this._entries.find((e) => e.id === entryId);
    if (!e) return;
    e.adjustment = e.adjustment === adj ? "none" : adj;
    this.render();
  }

  _removeEntry(entryId) {
    this._entries = this._entries.filter((e) => e.id !== entryId);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Party level
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
  // Budget bars
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
          <div style="display:flex; flex-direction:column; gap:12px; padding:4px 0;">
            <div>
              <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#c8a45e; text-transform:uppercase; letter-spacing:0.06em;">Theme / Traits</label>
              <input type="text" id="gen-theme-input"
                     placeholder="e.g. undead crypt, fey forest, fire giant"
                     autofocus style="width:100%; box-sizing:border-box;" />
              <p style="font-size:0.72rem; color:#b0a090; margin:4px 0 0;">Leave blank for a fully random encounter.</p>
            </div>
            <div>
              <label style="display:block; font-size:0.8rem; margin-bottom:6px; color:#c8a45e; text-transform:uppercase; letter-spacing:0.06em;">How spicy do you want this? 🌶</label>
              <div style="display:flex; gap:8px;">
                ${[
                  { v: 1, emoji: "🌶",       label: "Mild",   sub: "Low" },
                  { v: 2, emoji: "🌶🌶",     label: "Medium", sub: "Moderate" },
                  { v: 3, emoji: "🌶🌶🌶",   label: "Hot",    sub: "Severe" },
                ].map(({ v, emoji, label, sub }) => `
                  <label style="flex:1; text-align:center; cursor:pointer;">
                    <input type="radio" name="spice" value="${v}" ${v === 2 ? "checked" : ""} style="display:none;" />
                    <div class="spice-btn" data-spice="${v}"
                         style="border:1px solid ${v === 2 ? "rgba(200,164,94,0.6)" : "rgba(255,255,255,0.2)"}; border-radius:4px; padding:8px 4px; font-size:0.8rem; background:${v === 2 ? "rgba(200,164,94,0.15)" : "transparent"}; transition:all 0.15s;">
                      ${emoji}<br><strong>${label}</strong><br><span style="font-size:0.7rem; color:#b0a090;">${sub}</span>
                    </div>
                  </label>
                `).join("")}
              </div>
            </div>
          </div>
        `,
        render: (event, dialog) => {
          dialog.element.querySelectorAll(".spice-btn").forEach((btn) => {
            btn.closest("label").addEventListener("click", () => {
              dialog.element.querySelectorAll(".spice-btn").forEach((b) => {
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
            label: "Generate", default: true, action: "confirm",
            callback: (event, button, dialog) => {
              const theme = dialog.element.querySelector("#gen-theme-input")?.value?.trim() ?? "";
              const spice = parseInt(dialog.element.querySelector("input[name='spice']:checked")?.value ?? "2", 10);
              resolve({ theme, spice });
            },
          },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
        ],
      }).render(true);
    });
  }

  async _promptForSceneName() {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Create Encounter Scene" },
        content: `<p>Enter a name for the new scene:</p>
          <div style="margin:8px 0;">
            <input type="text" id="scene-name-input" placeholder="e.g. Goblin Ambush"
                   autofocus style="width:100%; box-sizing:border-box;" />
          </div>`,
        buttons: [
          { label: "Create Scene", default: true, action: "confirm",
            callback: (e, b, d) => resolve(d.element.querySelector("#scene-name-input")?.value?.trim() || "Unnamed Encounter") },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
        ],
      }).render(true);
    });
  }

  async _promptForLevel(actorName) {
    return new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: "Set Creature Level" },
        content: `<p><strong>${actorName}</strong> doesn't have a detectable level.</p>
          <p>Enter its level manually:</p>
          <div style="margin:8px 0;">
            <input type="number" id="manual-level-input" min="-1" max="25" value="1"
              autofocus style="width:80px; text-align:center;" />
          </div>`,
        buttons: [
          { label: "Add to Encounter", default: true, action: "confirm",
            callback: (e, b, d) => resolve(parseInt(d.element.querySelector("#manual-level-input")?.value, 10) || 1) },
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
      if (!scenes.length) { ui.notifications.warn("Encounter Builder: No scenes found."); return resolve(null); }
      const options = scenes.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
      new foundry.applications.api.DialogV2({
        window: { title: "Push to Scene" },
        content: `<p>Select a scene to push tokens to:</p>
          <div style="margin:8px 0;"><select id="scene-pick-select" style="width:100%;">${options}</select></div>`,
        buttons: [
          { label: "Push Tokens", default: true, action: "confirm",
            callback: (e, b, d) => resolve(d.element.querySelector("#scene-pick-select")?.value ?? null) },
          { label: "Cancel", action: "cancel", callback: () => resolve(null) },
        ],
      }).render(true);
    });
  }
}

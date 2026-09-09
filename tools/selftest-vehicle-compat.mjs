/** Real VAS and Addenda reconcilers on document CRUD fixtures with Foundry utilities.
 * node tools/selftest-vehicle-compat.mjs [Foundry resources/app] [VAS directory]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2] ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const vas = process.argv[3] ?? path.resolve(root, "../../foundry-audit/Data/modules/mmutons-cyberpunk-red-vas");
const utils = await import(pathToFileURL(path.join(app, "common/utils/helpers.mjs")));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-vehicle-compat-"));
const MOD = "cpr-addenda", OLD = "mmutons-cyberpunk-red-vas";
let checks = 0, nextId = 0, registrations = 0;
const equal = (a, b, name) => { checks++; assert.deepEqual(a, b, name); };
class Actors extends Map {
  [Symbol.iterator]() { return this.values(); }
  filter(fn) { return [...this.values()].filter(fn); }
}
globalThis.foundry = { utils };
globalThis.ActorSheet = class {};
globalThis.game = { actors: new Actors(), user: { isGM: true }, modules: new Map([[OLD, { active: false }]]),
  i18n: { localize: key => key, format: key => key } };
globalThis.CONFIG = { Actor: { sheetClasses: { character: {} } } };
const effect = data => Object.assign(utils.deepClone(data), { id: data._id ?? `effect${++nextId}`,
  getFlag(scope, key) {
    if (scope === OLD && !game.modules.get(OLD).active) throw new Error("Inactive flag scope");
    return utils.getProperty(this.flags?.[scope] ?? {}, key);
  } });
const actor = (id, flags) => {
  const doc = { id, uuid: `Actor.${id}`, flags: utils.deepClone(flags), effects: [], system: { stats: { move: { value: 6 } } },
    getFlag(scope, key) { return utils.getProperty(this.flags?.[scope] ?? {}, key); },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const created = data.map(effect); this.effects.push(...created); return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect"); this.effects = this.effects.filter(e => !ids.includes(e.id));
    } };
  game.actors.set(id, doc); return doc;
};
try {
  for (const file of fs.readdirSync(path.join(root, "scripts")).filter(f => f.endsWith(".js"))) {
    fs.writeFileSync(path.join(temp, file.replace(/\.js$/, ".mjs")), fs.readFileSync(path.join(root, "scripts", file), "utf8")
      .replace(/from "\.\/([^"\n]+)\.js"/g, 'from "./$1.mjs"'));
  }
  const { reconcileEffects, reconcileEffectsAfterPending, cleanupOrphanedEffects } = await import(pathToFileURL(path.join(temp, "vehicle-effects.mjs")));
  const { registerVasCompatibility, waitForLegacyVehicleEffects } = await import(pathToFileURL(path.join(temp, "vehicle-compat.mjs")));
  const legacySource = fs.readFileSync(path.join(vas, "scripts/vehicle-sheet.mjs"), "utf8");
  const Legacy = new Function("SystemUtils", legacySource.replace(/^import .*;\r?$/gm, "")
    .replace("export class VehicleSheet", "class VehicleSheet") + "\nreturn VehicleSheet;")({});
  const unwrappedLegacyReconcile = Legacy.reconcileEffects;
  globalThis.libWrapper = { register(scope, target, callback, mode) {
    equal(scope, MOD, "Wrapper belongs to Addenda");
    equal(target, "cprAddendaLegacyVehicleSheet.reconcileEffects", "Wrapper targets actual VAS static reconciler");
    equal(mode, "MIXED", "Migrated vehicles may delegate instead of invoking VAS");
    registrations++;
    const original = Legacy.reconcileEffects;
    Legacy.reconcileEffects = function (...args) { return callback.call(this, original.bind(this), ...args); };
  } };
  equal(registerVasCompatibility(), true, "Disabled VAS needs no patch");
  equal(registrations, 0, "Disabled module remains untouched");
  game.modules.get(OLD).active = true;
  equal(registerVasCompatibility(), false, "Unknown VAS API retains the warning fallback");
  CONFIG.Actor.sheetClasses.character[`${OLD}.VehicleSheet`] = { cls: Legacy };

  const rider = actor("rider", {});
  const positions = [{ id: "pilot", name: "Pilot", occupants: [rider.uuid], statMods: "REF:+2", matchOccupantMove: true }];
  const vehicle = actor("vehicle", { [MOD]: { vehiclePositions: positions }, [OLD]: { positions } });
  const foreign = [
    effect({ _id: "other-vas", flags: { [OLD]: { managedBy: "different" } }, changes: [{ key: "system.stats.ref.value", mode: 2, value: "3" }] }),
    effect({ _id: "other-addenda", flags: { [MOD]: { vehicleManagedBy: "different" } }, changes: [] }),
    effect({ _id: "ordinary", flags: {}, changes: [] }),
  ];
  rider.effects.push(...foreign);
  const managed = () => rider.effects.filter(e => e.flags?.[MOD]?.vehicleManagedBy === vehicle.id || e.flags?.[OLD]?.managedBy === vehicle.id);
  const ownRef = () => managed().flatMap(e => e.changes).filter(c => c.key === "system.stats.ref.value")
    .reduce((n, c) => n + Number(c.value), 0);
  const foreignPreserved = () => equal(rider.effects.filter(e => foreign.some(f => f.id === e.id)), foreign, "Effects from other vehicles and ordinary effects remain unchanged");
  await reconcileEffects(vehicle);
  await Legacy.reconcileEffects(vehicle);
  equal(managed().length, 2, "Unpatched VAS reproduces two effects alongside Addenda");
  equal(ownRef(), 4, "Unpatched existing reconcilers reproduce REF+4 instead of REF+2");
  equal(registerVasCompatibility(), true, "VAS patch registers for the real imported class");
  equal(registerVasCompatibility(), true, "Repeated registration is harmless");
  equal(registrations, 1, "Wrapper registered only once");
  await Legacy.reconcileEffects(vehicle);
  equal(managed().length, 1, "Legacy invocation delegates and removes existing duplicates");
  equal(ownRef(), 2, "Migrated vehicle grants REF+2 exactly once");
  equal(vehicle.effects.length, 1, "Pilot MOVE also retains only one vehicle effect");
  equal(vehicle.effects[0].flags[MOD].vehicleOccupantMovePos, "pilot", "Remaining MOVE belongs to Addenda");
  foreignPreserved();
  await Legacy.reconcileEffects(vehicle);
  await reconcileEffects(vehicle);
  await Promise.all([Legacy.reconcileEffects(vehicle), reconcileEffects(vehicle)]);
  equal(ownRef(), 2, "Repeated and simultaneous reconciliations do not stack modifiers");
  foreignPreserved();
  vehicle.flags[MOD].vehiclePositions = [];
  await Legacy.reconcileEffects(vehicle);
  equal(managed().length, 0, "Empty Addenda crew does not resurrect occupants from stale VAS positions");
  equal(vehicle.effects.length, 0, "Empty crew removes old pilot MOVE effects");
  foreignPreserved();

  const oldRider = actor("old-rider", {});
  const oldVehicle = actor("old-vehicle", { [OLD]: { positions: [{ id: "seat", name: "Seat", occupants: [oldRider.uuid], statMods: "REF:+2" }] } });
  await Legacy.reconcileEffects(oldVehicle);
  equal(oldRider.effects.length, 1, "Unmigrated VAS still grants its own effect");
  equal(oldRider.effects[0].flags[OLD].managedBy, oldVehicle.id, "Unmigrated VAS keeps its namespace");
  await reconcileEffects(oldVehicle);
  equal(oldRider.effects.length, 1, "Addenda does not clean legacy-only vehicles without migrated data");

  // Pause the actual VAS create operation while migration claims the vehicle.
  // Cover both a call through the wrapper and one already running beforehand.
  for (const alreadyRunning of [false, true]) {
    const raceRider = actor(`race-rider-${alreadyRunning}`, {});
    const secondRider = actor(`race-second-${alreadyRunning}`, {});
    const racePositions = [{ id: "race", name: "Race", occupants: [raceRider.uuid, secondRider.uuid], statMods: "REF:+2" }];
    const raceVehicle = actor(`race-vehicle-${alreadyRunning}`, { [OLD]: { positions: racePositions } });
    const create = raceRider.createEmbeddedDocuments;
    let release, started;
    const entered = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    raceRider.createEmbeddedDocuments = async function (type, data) {
      if (data[0]?.flags?.[OLD]) { started(); await gate; }
      return create.call(this, type, data);
    };
    const legacyCall = alreadyRunning ? unwrappedLegacyReconcile.call(Legacy, raceVehicle) : Legacy.reconcileEffects(raceVehicle);
    await entered;
    raceVehicle.flags[MOD] = { vehiclePositions: racePositions };
    let addonRelease, addonEntered;
    const addonStarted = new Promise(resolve => { addonEntered = resolve; });
    const addonGate = new Promise(resolve => { addonRelease = resolve; });
    const secondCreate = secondRider.createEmbeddedDocuments;
    let holdAddon = true;
    secondRider.createEmbeddedDocuments = async function (type, data) {
      if (holdAddon && data[0]?.flags?.[MOD]) { addonEntered(); await addonGate; }
      return secondCreate.call(this, type, data);
    };
    const addonCall = reconcileEffects(raceVehicle);
    await addonStarted;
    let legacySettled = false;
    const trackedLegacy = legacyCall.then(() => { legacySettled = true; });
    if (alreadyRunning) {
      let settled = false;
      const finalReady = waitForLegacyVehicleEffects(raceVehicle).then(async () => {
        await reconcileEffectsAfterPending(raceVehicle); settled = true;
      });
      await new Promise(resolve => setTimeout(resolve, 15));
      equal(settled, false, "Final ready reconciliation waits for a pre-wrapper VAS call");
      release();
      await legacyCall;
      await new Promise(resolve => setTimeout(resolve, 15));
      equal(settled, false, "Final cleanup also waits while Addenda is still processing rider two");
      holdAddon = false;
      addonRelease();
      await addonCall;
      await finalReady;
    } else {
      release();
      await new Promise(resolve => setTimeout(resolve, 15));
      equal(legacySettled, false, "Post-migration cleanup waits behind the active Addenda pass");
      holdAddon = false;
      addonRelease();
      await addonCall;
      await legacyCall;
    }
    await trackedLegacy;
    equal(raceRider.effects.length, 1, `Migration in flight leaves one effect (pre-wrapper=${alreadyRunning})`);
    equal(raceRider.effects.flatMap(e => e.changes).reduce((n, c) => n + Number(c.value), 0), 2,
      `Migration in flight retains REF+2 (pre-wrapper=${alreadyRunning})`);
    equal(secondRider.effects.length, 1, `Second rider retains one effect after concurrent migration (pre-wrapper=${alreadyRunning})`);
  }

  rider.effects.push(effect({ flags: { [OLD]: { managedBy: vehicle.id } }, changes: [] }));
  game.modules.get(OLD).active = false;
  await reconcileEffects(vehicle);
  equal(managed().length, 0, "Migrated legacy cleanup works with VAS disabled without invalid getFlag scope");
  foreignPreserved();
  rider.effects.push(effect({ flags: { [OLD]: { managedBy: vehicle.id } }, changes: [] }));
  await cleanupOrphanedEffects(vehicle.id);
  equal(managed().length, 0, "Deleting this Addenda vehicle removes its remaining legacy effects");
  foreignPreserved();
  equal(oldRider.effects.length, 1, "Orphan cleanup preserves another legacy vehicle's effects");
  console.log(JSON.stringify({ checks, failures: 0, legacySource: path.join(vas, "scripts/vehicle-sheet.mjs"),
    baselineModifier: 4, fixedModifier: 2, documentFixtures: game.actors.size }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

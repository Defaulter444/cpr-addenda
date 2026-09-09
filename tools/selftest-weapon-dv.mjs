/** Regression tests for weapon modes and DV selection. No world is changed.
 * node tools/selftest-weapon-dv.mjs [Cyberpunk RED system directory]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const system = process.argv[2] ?? path.resolve(root, "../../foundry-audit/Data/systems/cyberpunk-red-core");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-weapon-dv-"));
const MOD = "cpr-addenda", SYS = "cyberpunk-red-core";
let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };
const equal = (value, expected, message) => { checks++; assert.deepEqual(value, expected, message); };
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const docs = (dir) => fs.readdirSync(path.join(root, "sources", dir)).filter(f => f.endsWith(".json"))
  .map(f => read(path.join(root, "sources", dir, f)));
const tables = docs("addenda-dv-tables");
const weapons = docs("addenda-weapons");
const embedded = docs("addenda-actors").flatMap(actor => actor.items.filter(item => item.type === "weapon"));
const notifications = [];
const registrations = [];
function prop(object, key) { return key.split(".").reduce((value, part) => value?.[part], object); }
function writeProp(object, key, value) {
  const bits = key.split("."); let target = object;
  for (const bit of bits.slice(0, -1)) target = target[bit] ??= {};
  const last = bits.at(-1);
  if (last.startsWith("-=")) delete target[last.slice(2)];
  else target[last] = structuredClone(value);
}
function document(data) {
  return Object.assign(structuredClone(data), {
    id: data._id,
    getFlag(module, key) { return this.flags?.[module]?.[key]; },
    async setFlag(module, key, value) { (this.flags[module] ??= {})[key] = value; },
    async unsetFlag(module, key) { delete this.flags[module]?.[key]; },
    async update(changes) { for (const [key, value] of Object.entries(changes)) writeProp(this, key, value); },
    getInstalledItems() { return this.upgrades ?? []; },
  });
}
globalThis.foundry = { utils: { duplicate: structuredClone } };
globalThis.game = { system: { id: SYS }, settings: { get: () => true }, __dvTables: tables,
  i18n: { localize: key => key, format: key => key } };
globalThis.ui = { notifications: { warn: text => notifications.push(text), error: text => notifications.push(text) } };
globalThis.libWrapper = { register: (...args) => registrations.push(args) };

try {
  // Run the real 0.92.4 SetDvTable method. It defines the system flag schema;
  // the test does not invent a parallel implementation of that schema.
  const utils = fs.readFileSync(path.join(system, "modules/utils/cpr-systemUtils.js"), "utf8");
  const start = utils.indexOf("static async SetDvTable(");
  const open = utils.indexOf("{", start); let depth = 1, end = open + 1;
  while (depth && end < utils.length) { if (utils[end] === "{") depth++; if (utils[end] === "}") depth--; end++; }
  check(start >= 0 && !depth, "SystemUtils.SetDvTable can be loaded");
  const method = utils.slice(start, end).replace("static async", "async")
    .replace("CPRSystemUtils.GetDvTables()", "Promise.resolve(game.__dvTables)");
  fs.writeFileSync(path.join(temp, "system-utils.mjs"), `export default {${method}};`);
  fs.writeFileSync(path.join(temp, "actor-sheet.mjs"), "export default class Sheet {}\n");
  for (const name of ["constants", "cpr-config", "weapon-dv", "weapon-rules", "carrier-data", "carrier-changes", "install-restrictions"]) {
    let code = fs.readFileSync(path.join(root, "scripts", `${name}.js`), "utf8")
      .replace(/from "\.\/([^"\n]+)\.js"/g, 'from "./$1.mjs"')
      .replace('`/systems/${SYSTEM_ID}/modules/utils/cpr-systemUtils.js`', '"./system-utils.mjs"')
      .replace('`/systems/${SYSTEM_ID}/modules/actor/sheet/cpr-actor-sheet.js`', '"./actor-sheet.mjs"');
    fs.writeFileSync(path.join(temp, `${name}.mjs`), code);
  }
  const { resolveDvTable, getAttackRules, toggleWeaponFireMode, registerSystemDvPatch } = await import(pathToFileURL(path.join(temp, "weapon-dv.mjs")));
  const { applyWeaponRules } = await import(pathToFileURL(path.join(temp, "weapon-rules.mjs")));
  const { applyCarrierChanges, revertCarrierChanges } = await import(pathToFileURL(path.join(temp, "carrier-changes.mjs")));
  const { checkUpgradeFit, applyInstallRestrictions } = await import(pathToFileURL(path.join(temp, "install-restrictions.mjs")));

  const names = new Set(tables.map(table => table.name));
  equal(names.size, tables.length, "No duplicate table names");
  for (const table of tables) {
    let previous = -1;
    for (const row of table.results) {
      equal(row.range[0], previous + 1, `${table.name}: complete integer bands`);
      check(row.range[1] >= row.range[0], `${table.name}: valid band`);
      check(row.text === "N/A" || Number.isFinite(Number(row.text)), `${table.name}: numeric DV or N/A`);
      previous = row.range[1];
    }
  }
  const tableValues = name => tables.find(table => table.name === name).results.map(row => row.text);
  equal(tableValues("DV Pistol"), ["13","15","20","25","30","30","N/A","N/A"], "Unmodified pistol retains the basic table");
  equal(tableValues("СЛ Пистолет"), tableValues("DV Pistol"), "Russian and English basic pistol tables agree");
  equal(tableValues("Пистолет (стандартный)")[5], "35", "Installed barrel profile retains the expanded value");
  equal(tableValues("DV Long-Barrel Pistol"), ["14","13","14","20","25","28","30","N/A"], "Basic long-barrel pistol is not the expanded modification profile");
  // Expected mode families are independently taken from the weapon entries.
  const expected = {
    cprAddWp00010000: "Пистолет-пулемёт (Autofire)",
    cprAddWp00020000: "Пистолет (стандартный) (Autofire)",
    cprAddWp00040000: "Пистолет-пулемёт (Autofire)",
    cprAddWp00050000: "Пулемёт (Autofire)",
    cprAddWp00060000: "Пулемёт (Autofire)",
    cprAddWp00070000: "Штурмовая винтовка (Autofire)",
    cprAddWp00090000: "Пистолет (стандартный) (Autofire)",
    cprAddWp00100000: "DV SMG (Autofire)",
  };
  for (const data of [...weapons, ...embedded]) {
    const weapon = document(data);
    if (!weapon.system.isRanged) continue;
    check(names.has(resolveDvTable(weapon, "attack")), `${weapon.name}: single-shot table exists`);
    if (weapon.system.fireModes.autoFire > 0) {
      const actual = resolveDvTable(weapon, "autofire");
      check(names.has(actual), `${weapon.name}: Autofire table exists: ${actual}`);
      if (expected[weapon.id]) equal(actual, expected[weapon.id], `${weapon.name}: correct Autofire family`);
      const rows = tables.find(table => table.name === actual).results;
      equal(rows.at(-1).range[1], 100, `${weapon.name}: Autofire ends at 100 m`);
    }
  }
  for (const [base, family] of [["СЛ ПП", "СЛ ПП (Автоогонь)"], ["СЛ Штурмовая винтовка", "СЛ Штурмовая винтовка (Автоогонь)"], ["Карабин", "Штурмовая винтовка (Autofire)"], ["Марксманская винтовка", "Штурмовая винтовка (Autofire)"]]) {
    equal(resolveDvTable({}, "autofire", base), family, `${base}: barrel/localization preserves family`);
  }
  equal(resolveDvTable({}, "autofire", "DV SMG (Autofire)"), "DV SMG (Autofire)", "No duplicate suffix");
  equal(resolveDvTable({}, "autofire", "СЛ ПП (Автоогонь)"), "СЛ ПП (Автоогонь)", "No duplicate localized suffix");
  equal(resolveDvTable({}, "autofire", ""), "", "Empty table is not an invented Autofire table");

  const token = document({ _id: "token", flags: {} }); token.object = { document: token };
  const actor = document({ _id: "actor", flags: {} });
  actor.items = new Map(weapons.map(data => [data._id, document(data)]));
  actor.sheet = { actor, token };
  await registerSystemDvPatch();
  const checkbox = registrations[0][2];
  check(registrations[0][1].endsWith("._fireCheckboxToggle"), "Patch targets the actual system handler");
  for (const data of weapons.filter(data => data.system.fireModes.autoFire > 0)) {
    const weapon = actor.items.get(data._id); applyWeaponRules(weapon);
    const event = { currentTarget: { dataset: { itemId: weapon.id, fireMode: "autofire" } } };
    await checkbox.call(actor.sheet, () => { throw new Error("Broken original toggle executed"); }, event);
    equal(token.flags[SYS].cprDvTable.name, expected[weapon.id], `${weapon.name}: actual system flag switched`);
    check(Object.keys(token.flags[SYS].cprDvTable.table).length === 5, `${weapon.name}: flag contains Autofire rows`);
    check(!token.flags.cprDvTable, `${weapon.name}: no invalid unnamespaced flag`);
    await toggleWeaponFireMode(actor.sheet, weapon.id, "autofire");
    equal(token.flags[SYS].cprDvTable.name, weapon.system.dvTable, `${weapon.name}: table restored on toggle off`);
  }
  // Direct switching to Aimed used to leave the Autofire ruler rows behind.
  await toggleWeaponFireMode(actor.sheet, "cprAddWp00070000", "autofire");
  await toggleWeaponFireMode(actor.sheet, "cprAddWp00070000", "aimed");
  equal(token.flags[SYS].cprDvTable.name, "Боевая винтовка", "Autofire → aimed restores single-shot DV");

  function ruleItem(id) {
    const item = document(weapons.find(weapon => weapon._id === id));
    item.bulletConsumption = roll => /cpr-(autofire|suppressive-fire)-rollcard/.test(roll.rollCard) ? 10 : 1;
    item._createAttackRoll = function (type) { return { type, suppressiveDuring: this.system.fireModes.suppressiveFire }; };
    item._createDamageRoll = function (type) { return { type, formula: type === "autofire" ? "2d6" : this.system.damage, isAutofire: type === "autofire" }; };
    item._setDvTable = () => { throw new Error("Original double suffix path executed"); };
    applyWeaponRules(item); return item;
  }
  const auto = { rollCard: "systems/cyberpunk-red-core/templates/chat/cpr-autofire-rollcard.hbs" };
  const suppressive = { rollCard: "systems/cyberpunk-red-core/templates/chat/cpr-suppressive-fire-rollcard.hbs" };
  const single = { rollCard: "systems/cyberpunk-red-core/templates/chat/cpr-attack-rollcard.hbs" };
  const victoria = ruleItem("cprAddWp00050000");
  equal(victoria.bulletConsumption(auto), 20, "Victoria Autofire consumes 20");
  equal(victoria.bulletConsumption(suppressive), 20, "Victoria suppressive consumes 20");
  equal(victoria._createAttackRoll("attack"), null, "Victoria cannot fire single shots");
  equal(victoria._createAttackRoll("aimed"), null, "Victoria cannot fire aimed shots");
  await actor.setFlag(SYS, `firetype-${victoria.id}`, "autofire");
  await victoria._setDvTable(actor, victoria.system.dvTable);
  equal(token.flags[SYS].cprDvTable.name, "Пулемёт (Autofire)", "Victoria measure button resolves one suffix");
  const neo = ruleItem("cprAddWp00020000");
  equal(neo.bulletConsumption(auto), 4, "Neo Rapid Autofire consumes 4 slugs");
  equal(neo.bulletConsumption(single), 1, "Neo Rapid normal attack consumes 1");
  equal(neo._createAttackRoll("autofire").suppressiveDuring, true, "Autofire passes core's alternate-mode check");
  equal(neo.system.fireModes.suppressiveFire, false, "Core workaround does not grant suppressive fire");
  const deathwind = ruleItem("cprAddWp00080000");
  equal(deathwind._createAttackRoll("aimed"), null, "Deathwind cannot fire aimed shots");
  check(deathwind._createAttackRoll("attack"), "Deathwind ordinary attack stays available");

  neo._getLoadedAmmoProp = key => key === "variety" ? "shotgunSlug" : undefined;
  equal(getAttackRules(neo, "autofire"), {}, "Slugs retain normal Autofire multiplication");
  equal(neo._createDamageRoll("autofire").isAutofire, true, "Slug Autofire remains 2d6 times multiplier");
  neo.actor = actor;
  await actor.setFlag(MOD, `shotmode-${neo.id}`, true);
  equal(getAttackRules(neo, "autofire"), {}, "Loaded slug takes priority over stale manual shell flag");
  check(neo._createAttackRoll("aimed"), "Loaded slug stays aimable with stale shell flag");
  equal(neo._createDamageRoll("autofire").isAutofire, true, "Loaded slug retains Autofire damage with stale shell flag");
  neo._getLoadedAmmoProp = () => undefined;
  equal(getAttackRules(neo, "attack").shot, true, "Manual shell flag remains a fallback without installed ammo");
  await actor.unsetFlag(MOD, `shotmode-${neo.id}`);
  neo._getLoadedAmmoProp = key => key === "variety" ? "shotgunShell" : undefined;
  const shellRules = getAttackRules(neo, "autofire");
  equal([shellRules.evasionModifier, shellRules.dv, shellRules.maxRange], [-3,13,6], "Automatic shells: -3 Evasion, DV13, range6");
  equal(shellRules.ammoConsumption, 4, "Automatic shell rule consumes four");
  equal(neo._createDamageRoll("autofire"), { type: "attack", formula: "3d6", isAutofire: false }, "Automatic shells have ordinary 3d6 damage without multiplier");
  equal(neo._createDamageRoll("attack"), { type: "attack", formula: "3d6", isAutofire: false }, "Normal shells have ordinary 3d6 damage");
  equal(neo.system.damage, "5d6", "Shell damage override does not change stored weapon damage");
  equal(neo._createAttackRoll("aimed"), null, "Aimed shells are blocked before rolling");
  await actor.setFlag(SYS, `firetype-${neo.id}`, "autofire");
  await neo._setDvTable(actor, neo.system.dvTable);
  equal(token.flags[SYS].cprDvTable.table, { "0_6": "13" }, "Shell ruler uses fixed DV13 only within6m");

  for (const file of ["avtospusk-pistoleta.json", "uzel-avtomaticheskogo-upravleniya-ognem.json"]) {
    const upgrade = document(read(path.join(root, "sources/addenda-upgrades", file)));
    for (const [quality, oldAuto, wanted] of [["standard",0,3], ["excellent",0,4], ["standard",3,4], ["standard",5,4]]) {
      const carrier = document({ _id: "carrier", flags: {}, system: { quality, fireModes: { autoFire: oldAuto, suppressiveFire: false } } });
      await applyCarrierChanges(carrier, upgrade);
      equal(carrier.system.fireModes.autoFire, wanted, `${upgrade.name}: ${quality}/${oldAuto} → ${wanted}`);
      carrier.upgrades = [upgrade];
      equal(resolveDvTable(carrier, "autofire", "Пользовательский ствол"), "Пистолет (стандартный) (Autofire)", "Installed upgrade selects its own Autofire family");
      await revertCarrierChanges(carrier, upgrade);
      equal(carrier.system.fireModes.autoFire, oldAuto, "Uninstall restores original multiplier");
    }
    const previouslyInstalled = document({ _id: "old-weapon", flags: {}, type: "weapon", system: {
      quality: "excellent", fireModes: { autoFire: 3, suppressiveFire: false }
    } });
    previouslyInstalled.upgrades = [upgrade];
    applyWeaponRules(previouslyInstalled);
    equal(previouslyInstalled.system.fireModes.autoFire, 4, "Older installed excellent weapon derives the corrected maximum");
  }
  const barrelMods = docs("addenda-upgrades").filter(upgrade => upgrade.flags?.[MOD]?.carrierChanges?.["system.dvTable"]);
  for (const data of barrelMods) {
    const upgrade = document(data);
    const wanted = upgrade.flags[MOD].carrierChanges["system.dvTable"].value;
    check(names.has(wanted), `${upgrade.name}: assigned table exists`);
    const carrier = document({ _id: "barrel-weapon", flags: {}, system: { dvTable: "DV Pistol", quality: "standard" } });
    await applyCarrierChanges(carrier, upgrade);
    equal(carrier.system.dvTable, wanted, `${upgrade.name}: install sets profile`);
    await revertCarrierChanges(carrier, upgrade);
    equal(carrier.system.dvTable, "DV Pistol", `${upgrade.name}: removal restores original profile`);
  }
  const firstBarrel = document(barrelMods[0]), secondBarrel = document(barrelMods[1]);
  const weaponWithBarrel = document({ _id: "duplicate-test", flags: {}, type: "weapon", documentName: "Item", system: {} });
  weaponWithBarrel.upgrades = [firstBarrel];
  equal(checkUpgradeFit(secondBarrel, weaponWithBarrel).allowed, false, "Second range-table modification is rejected");
  weaponWithBarrel.upgrades = [];
  weaponWithBarrel.canInstallItems = () => true;
  applyInstallRestrictions(weaponWithBarrel);
  equal(weaponWithBarrel.canInstallItems([firstBarrel, secondBarrel]), false, "Two range-table modifications cannot be installed in one batch");
  console.log(JSON.stringify({ checks, failures: 0, tables: tables.length, weapons: weapons.length, embeddedWeapons: embedded.length, autofireWeapons: weapons.filter(weapon => weapon.system.fireModes.autoFire > 0).length, barrelMods: barrelMods.length }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

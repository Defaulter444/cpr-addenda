/** Regression: real Foundry expands dotted flag paths at its document boundary.
 * node tools/selftest-carrier-foundry.mjs [Foundry resources/app directory]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2] ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const utils = await import(pathToFileURL(path.join(app, "common/utils/helpers.mjs")));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-carrier-foundry-"));
globalThis.foundry = { utils: { ...utils, duplicate: structuredClone } };
globalThis.game = { settings: { get: () => true }, i18n: { localize: k => k, format: k => k } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
let checks = 0;
const equal = (actual, expected, name) => { checks++; assert.deepEqual(actual, expected, name); };
const create = data => Object.assign(utils.expandObject(structuredClone(data)), {
  id: data._id, documentName: "Item",
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
  async update(data) { utils.mergeObject(this, utils.expandObject(data), { performDeletions: true }); },
  getInstalledItems() { return this.upgrades ?? []; },
});
try {
  for (const file of fs.readdirSync(path.join(root, "scripts")).filter(f => f.endsWith(".js"))) {
    fs.writeFileSync(path.join(temp, file.replace(/\.js$/, ".mjs")),
      fs.readFileSync(path.join(root, "scripts", file), "utf8").replace(/from "\.\/([^"\n]+)\.js"/g, 'from "./$1.mjs"'));
  }
  const { getCarrierChanges, applyCarrierChanges, revertCarrierChanges } = await import(pathToFileURL(path.join(temp, "carrier-changes.mjs")));
  const { applyInstallRestrictions } = await import(pathToFileURL(path.join(temp, "install-restrictions.mjs")));
  const { weaponUpgradeFamily } = await import(pathToFileURL(path.join(temp, "weapon-dv.mjs")));
  const { applyWeaponRules } = await import(pathToFileURL(path.join(temp, "weapon-rules.mjs")));
  const raw = fs.readdirSync(path.join(root, "sources/addenda-upgrades")).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(root, "sources/addenda-upgrades", f), "utf8")));
  let changed = 0;
  for (const data of raw) {
    const expected = data.flags?.["cpr-addenda"]?.carrierChanges ?? {};
    const upgrade = create(data);
    equal(getCarrierChanges(upgrade), expected, `${data.name}: expanded flags preserve every declared change`);
    if (!Object.keys(expected).length) continue;
    changed++;
    const system = { quality: "standard", weaponType: "heavyPistol", fireModes: { autoFire: 0, suppressiveFire: false },
      dvTable: "DV Pistol", ammoVariety: ["heavyPistol"], installedItems: { slots: 3 }, handsReq: 1 };
    for (const [key, rule] of Object.entries(expected)) {
      if (utils.getProperty({ system }, key) === undefined) utils.setProperty({ system }, key,
        Array.isArray(rule.value) ? [] : typeof rule.value === "number" ? 0 : typeof rule.value === "boolean" ? false : "");
    }
    const weapon = create({ _id: "carrier", name: "Test weapon", type: "weapon", flags: {}, system });
    const initial = structuredClone(weapon.system);
    await applyCarrierChanges(weapon, upgrade);
    equal(Boolean(weapon.getFlag("cpr-addenda", "carrierRestore")?.[upgrade.id]?.system), true,
      `${data.name}: actual Foundry update stores nested restoration data`);
    if (expected["system.dvTable"]) {
      equal(weapon.system.dvTable, expected["system.dvTable"].value, `${data.name}: range modification applies`);
      equal(weaponUpgradeFamily(upgrade), "rangeProfile", `${data.name}: expanded flags identify range family`);
    }
    await revertCarrierChanges(weapon, upgrade);
    equal(weapon.system, initial, `${data.name}: every carrier value survives round trip`);
    equal(weapon.getFlag("cpr-addenda", "carrierRestore"), {}, `${data.name}: deletion survives Foundry object merge`);
    if (expected["system.dvTable"]) {
      await weapon.update({ "system.dvTable": "Custom original" });
      await applyCarrierChanges(weapon, upgrade);
      await revertCarrierChanges(weapon, upgrade);
      equal(weapon.system.dvTable, "Custom original", `${data.name}: reinstall records a fresh original`);
    }
  }
  const barrels = raw.filter(d => d.flags?.["cpr-addenda"]?.carrierChanges?.["system.dvTable"]).map(create);
  const weapon = create({ _id: "w", type: "weapon", system: { weaponType: "heavyPistol" }, flags: {} });
  weapon.upgrades = [barrels[0]];
  weapon.canInstallItems = () => true;
  applyInstallRestrictions(weapon);
  equal(weapon.canInstallItems([barrels[1]]), false, "Second imported range profile is rejected");

  const autosear = create(raw.find(d => d.flags?.["cpr-addenda"]?.weaponRule === "pistolAutosear"));
  const legacy = create({ _id: "legacy", name: "Existing autofire pistol", type: "weapon",
    system: { quality: "standard", fireModes: { autoFire: 3, suppressiveFire: false } },
    flags: { "cpr-addenda": { carrierRestore: { [autosear.id]: { "system.fireModes.autoFire": 3 } } } } });
  legacy.upgrades = [autosear];
  applyWeaponRules(legacy);
  equal(legacy.system.fireModes.autoFire, 4, "Legacy nested restore retains prior autofire capability");
  console.log(JSON.stringify({ checks, failures: 0, sourceUpgrades: raw.length, carrierModifications: changed,
    foundryHelpers: path.join(app, "common/utils/helpers.mjs") }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

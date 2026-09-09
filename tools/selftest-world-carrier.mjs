/** Actual core Container mixin + Foundry expand/merge: world Item clones.
 * node tools/selftest-world-carrier.mjs [Foundry resources/app] [system directory]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2] ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const system = process.argv[3] ?? path.resolve(root, "../../foundry-audit/Data/systems/cyberpunk-red-core");
const utils = await import(pathToFileURL(path.join(app, "common/utils/helpers.mjs")));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-world-carrier-"));
globalThis.foundry = { utils: { ...utils, duplicate: structuredClone } };
globalThis.game = { items: new Map(), settings: { get: () => true }, i18n: { localize: k => k, format: k => k } };
globalThis.ui = { notifications: { warn() {}, error() {} }, sidebar: { tabs: { items: { render() {} } } } };
let checks = 0, nextId = 0;
const equal = (actual, expected, name) => { checks++; assert.deepEqual(actual, expected, name); };
try {
  for (const file of fs.readdirSync(path.join(root, "scripts")).filter(f => f.endsWith(".js"))) {
    fs.writeFileSync(path.join(temp, file.replace(/\.js$/, ".mjs")), fs.readFileSync(path.join(root, "scripts", file), "utf8")
      .replace(/from "\.\/([^"\n]+)\.js"/g, 'from "./$1.mjs"'));
  }
  const { applyCarrierPatches } = await import(pathToFileURL(path.join(temp, "carrier-changes.mjs")));
  const { applyInstallRestrictions } = await import(pathToFileURL(path.join(temp, "install-restrictions.mjs")));
  const source = fs.readFileSync(path.join(system, "modules/item/mixins/cpr-container.js"), "utf8");
  // Keep every core method intact; provide only its imported services. In
  // particular, installItems, installWorldItems and uninstallItems are real.
  const Container = new Function("SystemUtils", "LOGGER", "CPRDialog",
    source.replace(/^import .*;\r?$/gm, "").replace("export class ContainerUtils", "class ContainerUtils")
      .replace("export default Container;", "return Container;"))({
    getDocTypesFromMixin: mixin => ({ equippable: ["weapon"], upgradable: ["weapon"],
      loadable: ["weapon"], container: ["weapon", "itemUpgrade"] }[mixin] ?? []),
    getMixins: type => type === "itemUpgrade" ? ["installable", "container"] : [],
    DisplayMessage() {}, Localize: k => k, Format: k => k,
  }, { debug() {} }, {});
  function create(data, ownedActor = null) {
    const doc = utils.expandObject(structuredClone(data));
    Object.assign(doc, { id: doc._id, documentName: "Item", actor: ownedActor,
      isOwned: !!ownedActor, isEmbedded: !!ownedActor,
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(updates) {
        utils.mergeObject(this, utils.expandObject(updates), { performDeletions: true });
        this.system.hasInstalled = this.system.installedItems.list.length > 0;
        return this;
      },
      toObject() { return { _id: this.id, name: this.name, type: this.type,
        flags: structuredClone(this.flags), system: structuredClone(this.system) }; },
      getTotalUpgradeValues() { return { type: "modifier", value: 0 }; },
    });
    Container.call(doc);
    applyInstallRestrictions(doc);
    applyCarrierPatches(doc);
    (ownedActor?.items ?? game.items).set(doc.id, doc);
    return doc;
  }
  globalThis.Item = { createDocuments: async list => list.map(item => {
    const data = item.toObject();
    data._id = `worldclone${String(++nextId).padStart(6, "0")}`;
    return create(data);
  }) };
  const readUpgrade = file => JSON.parse(fs.readFileSync(path.join(root, "sources/addenda-upgrades", file), "utf8"));
  const weaponData = id => ({ _id: id, name: "World pistol", type: "weapon", flags: {}, system: {
    weaponType: "heavyPistol", quality: "standard", dvTable: "DV Pistol", fireModes: { autoFire: 0, suppressiveFire: false },
    equipped: "owned", installedItems: { allowed: true, allowedTypes: ["itemUpgrade"], list: [], usedSlots: 0, slots: 3 },
  } });
  const original = create(readUpgrade("pistoletnyy-dlinnyy-stvol.json"));
  const pristine = original.toObject();
  const weapon = create(weaponData("worldweapon"));
  for (const base of ["DV Pistol", "Custom original"]) {
    await weapon.update({ "system.dvTable": base });
    equal(await weapon.installItems([original]), true, "World installation succeeds");
    const [clone] = weapon.getInstalledItems("itemUpgrade");
    equal(clone.id !== original.id, true, "Actual core installWorldItems clones the input");
    equal(weapon.system.dvTable, "Удлинённый пистолет", "World clone applies its range profile");
    equal(Object.keys(weapon.getFlag("cpr-addenda", "carrierRestore")), [clone.id], "Restore belongs to installed clone ID");
    equal(original.toObject(), pristine, "Source world upgrade is unchanged");
    await weapon.uninstallItems([clone]);
    equal(weapon.system.dvTable, base, "Removing cloned upgrade restores current original table");
    equal(weapon.getFlag("cpr-addenda", "carrierRestore"), {}, "Removing clone clears restoration data");
    equal(weapon.getInstalledItems(), [], "Core removes the installed clone from carrier");
  }
  // The same wrapper must continue to use original embedded IDs for actors.
  const actor = { items: new Map(), getOwnedItem(id) { return this.items.get(id); },
    async updateEmbeddedDocuments(_type, changes) {
      return Promise.all(changes.map(c => this.items.get(c._id).update(c)));
    } };
  const embeddedWeapon = create(weaponData("embeddedweapon"), actor);
  const embeddedUpgrade = create(readUpgrade("pistoletnyy-dlinnyy-stvol.json"), actor);
  equal(await embeddedWeapon.installItems([embeddedUpgrade]), true, "Embedded installation succeeds");
  equal(embeddedWeapon.system.dvTable, "Удлинённый пистолет", "Embedded installation still changes table");
  equal(Object.keys(embeddedWeapon.getFlag("cpr-addenda", "carrierRestore")), [embeddedUpgrade.id], "Embedded restore uses actual item ID");
  await embeddedWeapon.uninstallItems([embeddedUpgrade]);
  equal(embeddedWeapon.system.dvTable, "DV Pistol", "Embedded uninstallation restores original table");
  equal(embeddedWeapon.getFlag("cpr-addenda", "carrierRestore"), {}, "Embedded uninstallation clears restore data");
  console.log(JSON.stringify({ checks, failures: 0, coreContainer: path.join(system, "modules/item/mixins/cpr-container.js"),
    foundryHelpers: path.join(app, "common/utils/helpers.mjs"), worldClones: nextId }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

/** Real CPRActor and Container classes, using a minimal in-memory document adapter.
 * node tools/selftest-pkt-system.mjs [path to cyberpunk-red-core]
 * Browser-only UI/roll dependencies are stubbed; installation, removal, HP,
 * humanity and prerequisite decisions execute the installed system's code.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const system = path.resolve(process.argv[2] ?? path.join(root, "../../foundry-audit/Data/systems/cyberpunk-red-core"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-pkt-system-"));
const app = "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const utils = await import(pathToFileURL(path.join(app, "common/utils/helpers.mjs")));
const clone = structuredClone;
let assertions = 0, serial = 0;
const equal = (a, b, msg) => { assertions++; if(process.env.CPR_TEST_PROGRESS) console.log(assertions, msg); assert.deepEqual(a, b, msg); };
class Collection extends Array { get(id) { return this.find(i => i.id === id); } has(id) { return Boolean(this.get(id)); } }
globalThis.foundry = { utils: { ...utils, deepClone: clone, duplicate: clone } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} }, sidebar: { tabs: { items: { render() {} } } } };
globalThis.game = { settings: { get: () => true }, user: { isGM: true, id: "tester" }, items: new Collection(),
  system: { id: "cyberpunk-red-core" }, i18n: { localize: k => k, format: k => k } };
globalThis.Handlebars = { escapeExpression: String };
const systemUtils = { getDocTypesFromMixin: () => ["cyberware", "itemUpgrade"],
  getMixins: () => ["container", "installable"], DisplayMessage() {}, Format: k => k, Localize: k => k };
globalThis.__pktDeps = { SystemUtils: systemUtils, LOGGER: { debug() {}, warn() {} },
  CPRDialog: { showDialog: async data => ({ ...data, humanityLossType: "none" }) },
  CPRCharacterActorSheet: class {}, CPRMookActorSheet: class {}, CPR: {}, CPRChat: {}, CPRRolls: {},
  CPRActorUtils: {}, TextUtils: {}, CPRMod: {}, Rules: { lawyer() {} } };
let Container, CPRActor, applyBorgItemRules;
class MemoryActor {
  constructor() {
    this.id = `actor${++serial}`; this.name = this.id; this.documentName = "Actor"; this.type = "character";
    this.items = new Collection(); this.apps = {}; this.isEmbedded = false; this.isOwned = false;
    this._source = { system: { installedItems: { allowed: true, allowedTypes: ["cyberware"], list: [], usedSlots: 0 },
      stats: Object.fromEntries(["body", "will", "ref", "dex", "move", "emp"].map(k => [k, { value: k === "emp" ? 8 : 6, max: 8 }])),
      derivedStats: { humanity: { value: 80, max: 80 }, hp: { value: 40, max: 40 },
        walk: {}, run: {}, deathSave: { penalty: 0, basePenalty: 0 } } } };
    this.refresh();
  }
  refresh() {
    this.system = clone(this._source.system); this.bonuses = { maxHp: 0, maxHumanity: 0 };
    for (const item of this.items) item.refresh();
    for (const item of this.items.filter(i => i.system.isInstalledInActor || (i.type !== "cyberware" && i.system.equipped === "equipped"))) for (const effect of item._source.effects ?? []) {
      if (effect.disabled) continue;
      for (const change of effect.changes ?? []) {
        if (!change.key.startsWith("system.stats.")) continue;
        const previous = Number(utils.getProperty(this, change.key)) || 0, value = Number(change.value);
        utils.setProperty(this, change.key, change.mode === 5 ? value : change.mode === 4 ? Math.max(previous, value) : previous + value);
      }
    }
    if (this.applyActiveEffects) this.applyActiveEffects();
    if (this.loadMixins) this.loadMixins();
  }
  allApplicableEffects() { return []; }
  applyActiveEffects() {}
  get itemTypes() { return { cyberware: this.items.filter(i => i.type === "cyberware"), criticalInjury: [], armor: this.items.filter(i => i.type === "armor"), skill: [] }; }
  async update(data) { utils.mergeObject(this._source, utils.expandObject(clone(data))); this.refresh(); return this; }
  async createEmbeddedDocuments(type, data) { const docs = data.map(d => new MemoryItem(d, this)); this.items.push(...docs); this.refresh(); return docs; }
  async updateEmbeddedDocuments(type, updates) {
    for (const update of updates) { const item = this.items.get(update._id); if (item) utils.mergeObject(item._source, utils.expandObject(clone(update))); }
    this.refresh(); return updates;
  }
  async deleteEmbeddedDocuments(type, ids) { this.items = new Collection(...this.items.filter(i => !ids.includes(i.id))); this.refresh(); return ids; }
}
class MemoryItem {
  constructor(data, actor) {
    this._source = clone(data); this.id = `item${++serial}`; this._source._id = this.id;
    this.parent = actor; this.actor = actor; this.documentName = "Item"; this.isEmbedded = true; this.isOwned = true;
    this.refresh();
  }
  refresh() {
    Object.assign(this, { name: this._source.name, type: this._source.type, flags: this._source.flags ?? {}, img: this._source.img });
    this.system = clone(this._source.system);
    this.system.installedItems ??= { allowed: false, allowedTypes: [], list: [], usedSlots: 0, slots: 0 };
    Object.defineProperty(this.system, "isInstalledInActor", { get: () => {
      const reachable = new Set(this.actor.system.installedItems.list); let changed = true;
      while (changed) { changed = false; for (const id of [...reachable]) for (const child of this.actor.items.get(id)?.system.installedItems.list ?? [])
        if (!reachable.has(child)) { reachable.add(child); changed = true; } }
      return reachable.has(this.id);
    } });
    Object.defineProperty(this.system, "isInstalled", { get: () => this.system.isInstalledInActor || this.actor.items.some(i => i.system.installedItems.list.includes(this.id)) });
    Object.defineProperty(this.system, "installedIn", { get: () => this.actor.system.installedItems.list.includes(this.id) ? [this.actor.id] : this.actor.items.filter(i => i.system.installedItems.list.includes(this.id)).map(i => i.id) });
    Object.defineProperty(this.system, "hasInstalled", { get: () => this.system.installedItems.list.length > 0 });
    Container?.call(this); applyBorgItemRules?.(this);
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
  async update(data) { utils.mergeObject(this._source, utils.expandObject(clone(data))); this.actor.refresh(); return this; }
  async uninstall() {
    const parent = this.system.installedIn[0] === this.actor.id ? this.actor : this.actor.items.get(this.system.installedIn[0]);
    return parent?.uninstallItems([this]);
  }
  getTotalUpgradeValues() { return { type: "modify", value: 0 }; }
}
globalThis.Actor = MemoryActor;
try {
  for (const file of fs.readdirSync(path.join(root, "scripts")).filter(f => f.endsWith(".js"))) fs.writeFileSync(path.join(temp, file.replace(/\.js$/, ".mjs")),
    fs.readFileSync(path.join(root, "scripts", file), "utf8").replace(/(["'])\.\/([^"']+)\.js\1/g, '$1./$2.mjs$1'));
  const deps = "const { SystemUtils, LOGGER, CPRDialog, CPRCharacterActorSheet, CPRMookActorSheet, CPR, CPRChat, CPRRolls, CPRActorUtils, TextUtils, CPRMod, Rules } = globalThis.__pktDeps;\n";
  const importReal = async (relative, name, prefix = "") => {
    const body = fs.readFileSync(path.join(system, relative), "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
    const target = path.join(temp, name); fs.writeFileSync(target, deps + prefix + body);
    return import(pathToFileURL(target));
  };
  Container = (await importReal("modules/item/mixins/cpr-container.js", "system-container.mjs")).default;
  globalThis.__pktContainer = Container;
  CPRActor = (await importReal("modules/actor/cpr-actor.js", "system-actor.mjs", "const Container = globalThis.__pktContainer;\n")).default;
  const rules = await import(pathToFileURL(path.join(temp, "pkt-rules.mjs")));
  applyBorgItemRules = rules.applyBorgItemRules;
  globalThis.cprAddendaActorClass = CPRActor;
  globalThis.libWrapper = { register(scope, target, callback) {
    const parts = target.split("."), name = parts.pop(), owner = parts.reduce((obj, key) => obj[key], globalThis), original = owner[name];
    owner[name] = function (...args) { return callback.call(this, original.bind(this), ...args); };
  } };
  const coreEMP = (await importReal("modules/api/actor/empable-items.js", "system-emp-api.mjs")).default;
  game.cpr = { api: { actor: { getEMPableItems: coreEMP } } };
  rules.registerBorgActorPatches(CPRActor);
  const electronic = (id, names, extra={}) => ({ _id:id, id, name:id,
    system:{ isElectronic:true, isInstalledInActor:true, providesHardening:false, installedItems:{list:names}, ...extra } });
  const empHost = electronic("host", ["bio", "sibling"]), empBio = electronic("bio", []), empSibling = electronic("sibling", []);
  empBio.flags = { "cpr-addenda": { borgRule:{kind:"biosystem"} } };
  const empActor = { items:new Collection(empHost, empBio, empSibling) };
  equal(coreEMP(empActor), ["host", "bio", "sibling"], "Real core API lists unpatched electronic Biosystem");
  equal(game.cpr.api.actor.getEMPableItems(empActor), ["host", "sibling"], "Biosystem immunity does not harden host or sibling");
  equal(empBio.system.isElectronic, true, "Read-only EMP listing preserves Biosystem electronics");
  equal(empBio.system.providesHardening, false, "Biosystem gains no shared hardening flag");
  empSibling.system.providesHardening = true;
  equal(game.cpr.api.actor.getEMPableItems(empActor), [], "Ordinary child hardening still protects the host");
  const realMaxHumanity = CPRActor.prototype._calcMaxHumanity;
  CPRActor.prototype._calcMaxHumanity = function () { return rules.correctMaxHumanity(realMaxHumanity.call(this), this); };
  const kit = await import(pathToFileURL(path.join(temp, "pkt-kit.mjs")));
  const sources = fs.readdirSync(path.join(root, "sources/addenda-cyberware")).map(f => JSON.parse(fs.readFileSync(path.join(root, "sources/addenda-cyberware", f), "utf8")));
  const frames = sources.filter(i => i.flags?.["cpr-addenda"]?.pktKit);
  const expectedFrames = JSON.parse(fs.readFileSync(path.join(root, "docs/pkt-audit-expectations.json"), "utf8")).frames;
  const bioSource = sources.find(i => rules.borgRule(i).kind === "biosystem");
  const actor = new CPRActor();
  // Real characters contain core skills as well as core cyberware. Core skills
  // are not Containers and must never be asked for getInstalledItems().
  const skill = new MemoryItem({ name: "Core skill", type: "skill", system: { core: true } }, actor);
  actor.items.push(skill);
  const refreshSkill = skill.refresh.bind(skill);
  skill.refresh = function () { refreshSkill(); delete this.getInstalledItems; };
  actor.refresh();
  const [bio] = await actor.createEmbeddedDocuments("Item", [bioSource], { createInstalled: false });
  let previous;
  for (const data of frames) {
    const [frame] = await actor.createEmbeddedDocuments("Item", [data], { createInstalled: false });
    if (!previous) {
      equal(await kit.installPktFrame(frame), false, "Missing Biosystem must reject installation");
      equal(await actor.installItems([bio]), true, "Real Container installs Biosystem");
    }
    const before = actor._source.system.derivedStats.humanity.value;
    equal(await kit.installPktFrame(frame, { type: "none", value: 0 }), true, `${frame.name}: real install`);
    const parts = kit.kitPartsOf(actor, frame.id);
    equal(parts.length, kit.planKit(data.flags["cpr-addenda"].pktKit).length, `${frame.name}: complete kit`);
    equal(parts.every(i => i.system.isInstalledInActor), true, `${frame.name}: complete activation`);
    if (previous) equal(kit.kitPartsOf(actor, previous.id).every(i => !i.system.isInstalledInActor), true, `${frame.name}: old body inactive`);
    const penalty = expectedFrames[data._id].maxHumanityLoss;
    equal(parts.length, expectedFrames[data._id].parts, `${frame.name}: published part count`);
    equal(actor.system.stats.body.value, expectedFrames[data._id].body, `${frame.name}: published BODY`);
    equal(actor._calcMaxHumanity(), 76 - penalty, `${frame.name}: therapy ceiling`);
    equal(actor.system.derivedStats.humanity.value, Math.min(before, 76 - penalty), `${frame.name}: clamp only, no package charge`);
    equal(actor.system.derivedStats.hp.value, actor.calcMaxHp(), `${frame.name}: entering restores HP`);
    equal(actor._getArmorValue("sp", "body"), expectedFrames[data._id].sp, `${frame.name}: actual armor SP`);
    equal(actor.getArmorPenaltyMods("ref"), expectedFrames[data._id].armorPenalty, `${frame.name}: conditional armor penalty`);
    const ids = parts.map(i => i.id);
    await kit.uninstallPktFrame(frame);
    equal(parts.every(i => !i.system.isInstalledInActor), true, `${frame.name}: whole kit inactive`);
    equal(actor._calcMaxHumanity(), 76, `${frame.name}: Biosystem alone`);
    const humanity = actor.system.derivedStats.humanity.value;
    await kit.installPktFrame(frame, { type: "static", value: 99 });
    equal(actor.system.derivedStats.humanity.value, humanity, `${frame.name}: already used body is not charged again`);
    equal(kit.kitPartsOf(actor, frame.id).map(i => i.id), ids, `${frame.name}: reinstall preserves IDs`);
    previous = frame;
  }
  equal(frames.length, 13, "All thirteen FBCs covered");
  const [failed] = await actor.createEmbeddedDocuments("Item", [frames[0]], { createInstalled: false });
  const before = kit.snapshotPktState(actor);
  const realInstall = actor.installItems;
  // Persistent boundary failure, after all parts have been created and populated.
  const realUpdate = actor.update.bind(actor);
  actor.update = async function (data) {
    if (data["system.installedItems"]?.list?.includes(failed.id)) throw new Error("Injected persistence failure");
    return realUpdate(data);
  };
  await assert.rejects(kit.installPktFrame(failed, { type: "static", value: 20 }), /Injected persistence failure/); assertions++;
  delete actor.update;
  equal(kit.kitPartsOf(actor, failed.id).length, 0, "Failure leaves no partial parts");
  equal(actor._source.system.installedItems, before.installedItems, "Failure restores installation graph");
  equal(actor._source.system.derivedStats.humanity, before.humanity, "Failure restores humanity exactly");
  equal(actor._source.system.derivedStats.hp, before.hp, "Failure restores HP exactly");
  equal(await kit.installPktFrame(failed), true, "Failed transaction can be retried");
  const organic = new CPRActor();
  const omega = sources.find(i => rules.borgRule(i).body === 16 && !kit.getKit(i));
  equal(rules.checkBorgPrerequisites(organic, omega).ok, false, "Organic Omega requires muscles/BODY");
  equal(rules.checkBorgPrerequisites(actor, omega).ok, false, "FBC rejects a second internal frame");
  const activeInternal = actor.items.find(i => i.system.isInstalledInActor && rules.borgRule(i).kind === "internalFrame");
  await activeInternal.uninstall();
  equal(rules.checkBorgPrerequisites(actor, omega).ok, true, "FBC waives organic frame prerequisites after removing prior frame");
  const muscle = { name: "Grafted Muscle and Bone Lace", type: "cyberware",
    flags: { "cpr-addenda": { borgRule: { kind: "graftedMuscle" } } },
    effects: [{ changes: [{ key: "system.stats.body.value", mode: 2, value: "2" }] }],
    system: { type: "cyberwareInternal", humanityLoss: { static: 14, roll: "4d6" }, size: 1 } };
  const muscles = await organic.createEmbeddedDocuments("Item", [muscle, muscle, muscle], { createInstalled: false });
  await organic.installItems(muscles);
  equal(organic.system.stats.body.value, 10, "Three muscle laces cannot raise biological BODY past 10");
  const [omegaItem] = await organic.createEmbeddedDocuments("Item", [omega], { createInstalled: false });
  equal(await organic.installItems([omegaItem]), true, "BODY 10 and three laces satisfy Omega prerequisites");
  equal(organic.system.stats.body.value, 16, "Internal Omega sets BODY 16");
  equal(organic.calcMaxHp(), 65, "Internal Omega affects HP");
  equal(organic._calcMaxHumanity(), 66, "Organic Omega counts as two borgware installations, plus three laces");
  const gearFiles = fs.readdirSync(path.join(root, "sources/addenda-gear")).map(f => JSON.parse(fs.readFileSync(path.join(root, "sources/addenda-gear", f), "utf8")));
  const external = gearFiles.find(i => rules.borgRule(i).kind === "externalFrame" && /omega|омега/i.test(i.name));
  if (external) {
    const unaugmented = new CPRActor();
    const [ex] = await unaugmented.createEmbeddedDocuments("Item", [external], { createInstalled: false });
    await ex.update({ "system.equipped": "equipped" });
    equal(unaugmented.system.stats.body.value, 16, "Equipped external Omega supplies strength");
    equal(unaugmented.calcMaxHp(), 40, "External Omega does not increase HP");
    equal(rules.biologicalBody(unaugmented), 6, "External Omega does not increase Death Save BODY");
  }
  console.log(JSON.stringify({ assertions, failures: 0, frames: frames.length, systemClass: path.join(system, "modules/actor/cpr-actor.js") }, null, 2));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

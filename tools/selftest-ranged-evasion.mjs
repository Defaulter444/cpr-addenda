import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts/ranged-evasion.js"), "utf8");
const {getEvasionSkill, hasReflexCoProcessor, canEvadeRanged} = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
globalThis.game = {i18n: {localize: () => "Ausweichen"}};
const physicalSource = "Compendium.world.mook-skills.Item.DOHBotVfb7OAFZuq";
const coSource = "Compendium.cyberpunk-red-core.black-chrome_cyberware.Item.0z0v50kDAgHvMquv";
const skill = (name = "Evasion", source, level = 4) => ({id: name, type: "skill", name, system: {level, stat: "dex"}, flags: {core: {sourceId: source}}});
const processor = (name = "Reflex Co-Processor", source = coSource) => ({id: "processor", type: "cyberware", name, system: {type: "neuralWare", usage: "installed", installedItems: {list: []}}, flags: {core: {sourceId: source}}});
const actor = (items = [skill()], ref = 8, installed = []) => ({items, system: {stats: {ref: {value: ref}}, installedItems: {list: installed}}});
let checks = 0;
const eq = (a, b, message) => { checks++; assert.equal(a, b, message); };
const evasion = skill(), physical = skill("Физические", physicalSource, 11);
physical.system.stat = "int";
eq(getEvasionSkill(actor([physical, evasion])), evasion, "A real Evasion skill takes priority over the legacy group");
const placeholder = skill("Evasion", undefined, 0);
Object.assign(placeholder.system, {core: true, basic: true});
eq(getEvasionSkill(actor([placeholder, physical])), physical, "The exact legacy Physical source overrides the NPC's default zero-rank core placeholder");
eq(getEvasionSkill(actor([skill("Evasion", undefined, 0), physical])).name, "Evasion", "A manual custom rank-zero Evasion is not silently replaced");
eq(getEvasionSkill(actor([physical])), physical, "Exact Physical compendium source is recognized");
eq(physical.system.stat, "int", "The NPC's authored flat-base stat is preserved");
eq(getEvasionSkill(actor([skill("Ренейм", "Item.DOHBotVfb7OAFZuq")] )).name, "Ренейм", "Exact legacy Item source survives renaming");
eq(getEvasionSkill(actor([skill("Боевые", "Compendium.world.mook-skills.Item.6HtGd8psScyMj4my")])), null, "Martial explicitly excludes Evasion");
eq(getEvasionSkill(actor([skill("Physical"), skill("Физические")])), null, "Unproven custom names are not guessed");
eq(getEvasionSkill(actor([skill("Renamed", "Compendium.cyberpunk-red-core.internal_skills.Item.CzaAkwAjPDplz4nn")] )).name, "Renamed", "Core Evasion source survives renaming");
eq(getEvasionSkill(actor([skill("Уклонение")] )).name, "Уклонение", "Russian migrated skill supported");
eq(getEvasionSkill(actor([skill("Ausweichen")] )).name, "Ausweichen", "Current system localization supported");
eq(canEvadeRanged(actor()), true, "REF 8 passes");
eq(canEvadeRanged(actor([evasion], 7)), false, "REF 7 without processor does not pass");
eq(canEvadeRanged(actor([evasion], 7), {enforceRef8: false}), true, "The module's existing explicit setting can disable the REF gate");
eq(canEvadeRanged(actor([skill("Evasion", undefined, 0)])), true, "Existing rank-zero skill remains rollable");
eq(canEvadeRanged(actor([], 8)), false, "Missing skill requires a caller's untrained-roll fallback");
for (const invalid of [undefined, null, "", false, -1, NaN, Infinity]) eq(canEvadeRanged(actor([skill("Evasion", undefined, invalid)].map(s => ({...s, system: {...s.system, level: invalid}})))), false, "Invalid skill rank rejected: " + String(invalid));
const co = processor();
const neural = {id: "neural", type: "cyberware", system: {installedItems: {list: [co.id]}}};
eq(canEvadeRanged(actor([evasion, co], 5, [co.id])), true, "Installed processor lifts REF gate");
eq(canEvadeRanged(actor([evasion, co], 5)), false, "Merely carried processor does not lift REF gate");
eq(hasReflexCoProcessor(actor([co, neural], 5, [neural.id])), true, "Installed Neural Link containing the processor is supported");
eq(hasReflexCoProcessor(actor([co, neural], 5)), false, "Processor installed in a spare carried Neural Link is not implanted");
eq(hasReflexCoProcessor(actor([processor("Переименован")], 5, [co.id])), true, "Known processor source survives renaming");
eq(hasReflexCoProcessor(actor([processor("Сопроцессор рефлексов", undefined)], 5, [co.id])), true, "Translated processor with known source supported");
const legacyCo = processor("Сопроцессор рефлексов"); delete legacyCo.flags;
eq(hasReflexCoProcessor(actor([legacyCo], 5, [co.id])), true, "Legacy exact translated name without source supported");
eq(hasReflexCoProcessor(actor([processor("Reflex Co-Processor", "Compendium.other.fake.Item.not-a-processor")], 5, [co.id])), false, "Unrelated sourced item is not reclassified by name");
eq(hasReflexCoProcessor(actor([{...co, type: "gear"}], 5, [co.id])), false, "Only cyberware grants the benefit");
const cycleA = {id: "a", type: "cyberware", system: {installedItems: {list: ["b"]}}};
const cycleB = {id: "b", type: "cyberware", system: {installedItems: {list: ["a"]}}};
eq(hasReflexCoProcessor(actor([cycleA, cycleB], 5, ["a"])), false, "Corrupt cyclic installation lists terminate");
eq(hasReflexCoProcessor(actor([co], 5, ["missing"])), false, "Deleted child item does not count");
const mapActor = actor([evasion, co], 5, [co.id]); mapActor.items = new Map(mapActor.items.map(item => [item.id, item]));
eq(canEvadeRanged(mapActor), true, "Foundry collection-like values supported");
const babeleCo = processor("Reflex Co-Processor", "Compendium.cyberpunk-red-core.dlc_exotics-of-2045.Item.0z0v50kDAgHvMquv");
eq(hasReflexCoProcessor(actor([babeleCo], 5, [co.id])), true, "Second actual core pack source supported");

// Check every corresponding authored record in the audit snapshot, without
// opening or modifying a live LevelDB pack.
const recordsPath = process.argv[2] ?? path.resolve(root, "../../pack-records.jsonl");
let realPhysical = 0, realProcessors = 0;
const records = fs.readFileSync(recordsPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
for (const row of records) {
  const item = row.doc;
  const source = item?.flags?.core?.sourceId ?? item?._stats?.compendiumSource;
  if (item?.type === "skill" && [physicalSource, "Item.DOHBotVfb7OAFZuq"].includes(source)) {
    eq(getEvasionSkill(actor([item])), item, "Real Physical record " + row.key); realPhysical++;
  }
  if (item?.type === "cyberware" && item.name === "Reflex Co-Processor" && item._id === "0z0v50kDAgHvMquv") {
    eq(hasReflexCoProcessor(actor([item], 5, [item._id])), true, "Real processor record " + row.pack); realProcessors++;
  }
}
assert.ok(realPhysical > 0 && realProcessors === 2, "Both actual item packs and legacy NPC records were covered");
const npcPack = "night-city-gang-and-corp-mook-pack.NCGangsnCorpsMooks";
const index = new Map(records.filter(row => row.pack === npcPack).map(row => [row.key, row.doc]));
let realPhysicalOwners = 0;
for (const [key, raw] of index) {
  if (!key.startsWith("!actors!")) continue;
  const items = raw.items.map(id => index.get(`!actors.items!${raw._id}.${id}`)).filter(Boolean);
  const physical = items.find(item => item.type === "skill" && [physicalSource, "Item.DOHBotVfb7OAFZuq"].includes(item.flags?.core?.sourceId ?? item._stats?.compendiumSource));
  if (!physical) continue;
  const owner = {...raw, items, itemTypes: {skill: items.filter(item => item.type === "skill")}};
  const defaultEvasion = owner.itemTypes.skill.find(item => item.name === "Evasion");
  eq(defaultEvasion?.system.level, 0, `${raw.name}: real pack contains the zero-rank placeholder`);
  eq(getEvasionSkill(owner), physical, `${raw.name}: resolve Physical in the complete real actor context`);
  eq(canEvadeRanged(owner), Number(raw.system.stats.ref.value) >= 8, `${raw.name}: the actor's REF gate is preserved`);
  realPhysicalOwners++;
}
eq(realPhysicalOwners, 108, "All 108 real actor owners were covered, separate from the 109 stored skill records");
console.log(JSON.stringify({checks, realPhysical, realPhysicalOwners, realProcessors, failures: 0}, null, 2));

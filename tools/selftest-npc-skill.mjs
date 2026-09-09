/** Run the system's real Attackable constructor against the translated NPC skill.
 * node tools/selftest-npc-skill.mjs [system-directory] [pack-records.jsonl]
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const system = process.argv[2] ?? path.resolve(root, "../../foundry-audit/Data/systems/cyberpunk-red-core");
const recordsPath = process.argv[3] ?? path.resolve(root, "../../pack-records.jsonl");
const moduleSource = fs.readFileSync(path.join(root, "scripts/weapon-skill-compat.js"), "utf8");
const { applyAttackSkillCompatibility } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
const source = fs.readFileSync(path.join(system, "modules/item/mixins/cpr-attackable.js"), "utf8")
  .replace(/^import .*\n/gm, "").replace("export default Attackable;", "return Attackable;");
class AttackRoll {
  constructor(weapon, stat, statValue, skill, skillValue) { Object.assign(this, { weapon, stat, statValue, skill, skillValue }); }
  addMod() {}
}
class AimedRoll extends AttackRoll {}
class AutoRoll extends AttackRoll {}
class SuppressiveRoll extends AttackRoll {}
const rolls = { CPRAttackRoll: AttackRoll, CPRAimedAttackRoll: AimedRoll, CPRAutofireRoll: AutoRoll,
  CPRSuppressiveFireRoll: SuppressiveRoll, rollTypes: { ATTACK: "attack", AIMED: "aimed", AUTOFIRE: "autofire", SUPPRESSIVE: "suppressive" } };
const Attackable = new Function("CPRRolls", "LOGGER", "Rules", "CPRMod", "SystemUtils", source)(
  rolls, { debug() {} }, { lawyer() {} }, { getAllModifiers: () => [], getRelevantMods: () => [] },
  { Localize: value => value, Format: value => value, hasMixin: () => false,
    slugify: value => value.toLowerCase().replace(/\s+/g, "-") }
);
const rows = fs.readFileSync(recordsPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
const pack = "night-city-gang-and-corp-mook-pack.NCGangsnCorpsMooks";
const index = new Map(rows.filter(row => row.pack === pack).map(row => [row.key, row.doc]));
let checks = 0, originalFailures = 0, fixedRolls = 0, cyberweapons = 0;
const equal = (a,b,text) => { checks++; assert.deepEqual(a,b,text); };
function actorDocument(raw) {
  const actor = structuredClone(raw);
  actor.items = raw.items.map(id => structuredClone(index.get(`!actors.items!${raw._id}.${id}`)));
  actor.itemTypes = { role: [] };
  actor.allApplicableEffects = () => [];
  actor.getSkillLevel = name => actor.items.find(item => item.type === "skill" && item.name === name)?.system.level;
  actor.getStat = stat => actor.system.stats[stat]?.value ?? 0;
  actor.getArmorPenaltyMods = () => 0;
  actor.getWoundStateMods = () => 0;
  return actor;
}
function weaponDocument(raw) {
  const item = structuredClone(raw);
  item.getTotalUpgradeValues = () => ({ type: "modifier", value: 0 });
  item.hasAmmo = () => true;
  Attackable.call(item);
  return item;
}
for (const [key, raw] of index) {
  if (!key.startsWith("!actors.items!") || raw.type !== "cyberware" || !raw.system.isWeapon || raw.system.weaponSkill !== "Martial") continue;
  const ownerId = key.split("!").at(-1).split(".")[0];
  const actor = actorDocument(index.get(`!actors!${ownerId}`));
  const item = weaponDocument(raw);
  cyberweapons++;
  const expected = actor.items.find(skill => skill.type === "skill" && skill.name === "Боевые");
  assert.ok(expected, `${actor.name}: translated combat skill exists`);
  const modes = ["attack", ...(item.system.isRanged ? ["aimed"] : [])];
  for (const mode of modes) {
    assert.throws(() => item._createAttackRoll(mode, actor), /reading 'name'/);
    originalFailures++;
  }
  applyAttackSkillCompatibility(item);
  for (const mode of modes) {
    const roll = item._createAttackRoll(mode, actor);
    equal(roll.skill, "Боевые", `${actor.name}/${item.name}: resolved custom skill`);
    equal(roll.skillValue, expected.system.level, `${actor.name}/${item.name}: original skill rank preserved`);
    equal(item.system.weaponSkill, "Martial", "The stored weapon reference is unchanged");
    fixedRolls++;
  }
}
equal(cyberweapons, 39, "All 39 affected embedded cyberweapons were tested");
equal(originalFailures, 63, "The real system constructor reproduces all 63 original failures");
equal(fixedRolls, 63, "The bridge fixes all 63 attack/aimed constructions");

const sourceId = "Compendium.world.mook-skills.Item.6HtGd8psScyMj4my";
function narrowCase(skills) {
  const actor = { items: skills };
  const item = { system: { weaponSkill: "Martial" }, _createAttackRoll(_mode, owner) {
    const skill = owner.items.find(item => item.name === this.system.weaponSkill);
    return skill.name;
  } };
  applyAttackSkillCompatibility(item);
  return { actor, item };
}
const english = narrowCase([{ name: "Martial", type: "skill" }, { name: "Боевые", type: "skill", flags: { core: { sourceId } } }]);
equal(english.item._createAttackRoll("attack", english.actor), "Martial", "An existing exact original skill takes priority");
const unrelated = narrowCase([{ name: "Боевые", type: "skill" }]);
assert.throws(() => unrelated.item._createAttackRoll("attack", unrelated.actor)); checks++;
const exception = narrowCase([{ name: "Боевые", type: "skill", flags: { core: { sourceId } } }]);
exception.item.system.weaponSkill = "Martial Arts";
assert.throws(() => exception.item._createAttackRoll("attack", exception.actor)); checks++;
equal(exception.item.system.weaponSkill, "Martial Arts", "Martial Arts is not mapped to the custom Martial group");
console.log(JSON.stringify({ checks, cyberweapons, originalFailures, fixedRolls, failures: 0 }, null, 2));

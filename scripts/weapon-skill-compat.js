/** Compatibility with the translated custom skill in Night City Mook Pack.
 * Its weapons refer to "Боевые", but 39 embedded cyberweapons still refer to
 * the original "Martial". This is the pack's combined skill, not Martial Arts.
 */
const MARTIAL_SOURCE = "Compendium.world.mook-skills.Item.6HtGd8psScyMj4my";
const NPC_PACK_SOURCE = "Compendium.night-city-gang-and-corp-mook-pack.NCGangsnCorpsMooks.";

function sourceOf(document) {
  return document?.flags?.core?.sourceId ?? document?._stats?.compendiumSource ?? "";
}

export function legacyNpcSkill(actor, required) {
  if (required !== "Martial") return undefined;
  if (actor?.items?.find(item => item.type === "skill" && item.name === required)) return undefined;
  const translated = actor?.items?.find(item => item.type === "skill" && item.name === "Боевые");
  if (!translated) return undefined;
  // Avoid guessing that another character's similarly named custom skill has
  // the same meaning. The original compendium keeps these source identifiers.
  return sourceOf(translated) === MARTIAL_SOURCE || sourceOf(actor).startsWith(NPC_PACK_SOURCE)
    ? translated : undefined;
}

export function applyAttackSkillCompatibility(item) {
  if (typeof item?._createAttackRoll !== "function") return;
  const attack = item._createAttackRoll;
  item._createAttackRoll = function (type, actor, ...args) {
    const original = this.system?.weaponSkill;
    const skill = legacyNpcSkill(actor, original);
    if (!skill) return attack.call(this, type, actor, ...args);
    // The system constructor is synchronous. Only its lookup uses the resolved
    // name; the actor's skill, item source, level and stored data stay intact.
    this.system.weaponSkill = skill.name;
    try { return attack.call(this, type, actor, ...args); }
    finally { this.system.weaponSkill = original; }
  };
}

/** Shared ranged defense eligibility; does not roll or change actor data.
 * Reflex Co-Processor: Black Chrome p21 / Interface RED v2 p73.
 * The legacy NPC pack explicitly assigns Evasion to Physical, not Martial.
 */
const PHYSICAL_SOURCES = new Set([
  "Compendium.world.mook-skills.Item.DOHBotVfb7OAFZuq",
  "Item.DOHBotVfb7OAFZuq",
]);
const EVASION_SOURCES = new Set([
  "Compendium.cyberpunk-red-core.internal_skills.Item.CzaAkwAjPDplz4nn",
  "Item.CzaAkwAjPDplz4nn",
]);
const COPROCESSOR_ID = "0z0v50kDAgHvMquv";
const COPROCESSOR_SOURCES = new Set([
  `Compendium.cyberpunk-red-core.black-chrome_cyberware.Item.${COPROCESSOR_ID}`,
  `Compendium.cyberpunk-red-core.dlc_exotics-of-2045.Item.${COPROCESSOR_ID}`,
]);
const COPROCESSOR_NAMES = new Set(["reflex co-processor", "сопроцессор рефлексов"]);

function sourceOf(item) {
  return item?.flags?.core?.sourceId ?? item?._stats?.compendiumSource ?? "";
}

function ownedItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.contents)) return items.contents;
  return typeof items?.values === "function" ? Array.from(items.values()) : [];
}

/** Return the real skill so its original stat, rank and effects remain intact. */
export function getEvasionSkill(actor) {
  const skills = actor?.itemTypes?.skill ?? ownedItems(actor).filter(item => item.type === "skill");
  const canonical = skills.find(item => item.name === "Evasion" || EVASION_SOURCES.has(sourceOf(item)));
  const localized = globalThis.game?.i18n?.localize?.("CPR.global.itemType.skill.evasion");
  const translated = skills.find(item => item.name === "Уклонение" || (localized && item.name === localized));
  // Do not infer a replacement from a similar name. This exact authored skill
  // explicitly includes Evasion, whereas Martial's description excludes it.
  const physical = skills.find(item => PHYSICAL_SOURCES.has(sourceOf(item))) ?? null;
  const evasion = canonical ?? translated;
  if (!evasion) return physical;
  // The shipped NPCs retain all default core skills at rank 0, alongside their
  // authored combined skills. That placeholder must not mask Physical's base.
  // Keep a trained Evasion or a manually authored custom skill as an override.
  const placeholder = evasion.system?.core === true && evasion.system?.basic === true &&
    (evasion.system.level === 0 || evasion.system.level === "0");
  if (physical && placeholder) return physical;
  return evasion;
}

/** The container lists are the source of truth in CPR 0.92.4.
 * A processor inside a spare Neural Link carried in a bag is not implanted.
 */
export function hasReflexCoProcessor(actor) {
  const items = ownedItems(actor);
  const byId = new Map(items.map(item => [item.id ?? item._id, item]));
  const pending = [...(actor?.system?.installedItems?.list ?? [])];
  const installed = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (installed.has(id)) continue;
    installed.add(id);
    const item = byId.get(id);
    if (!item) continue;
    if(Number(item.flags?.['cpr-addenda']?.empUntil) > Number(globalThis.game?.time?.worldTime ?? Infinity)) continue;
    const source = sourceOf(item);
    const knownProcessor = COPROCESSOR_SOURCES.has(source) ||
      (item.id ?? item._id) === COPROCESSOR_ID ||
      (!source && COPROCESSOR_NAMES.has(String(item.name ?? "").trim().toLowerCase()));
    if (item.type === "cyberware" && knownProcessor) return true;
    pending.push(...(item.system?.installedItems?.list ?? []));
  }
  return false;
}

/** Existing rank-zero skills can be rolled; the rule has no trained-skill gate.
 * Missing skill items need a separate untrained-roll implementation in callers.
 */
export function canEvadeRanged(actor, { enforceRef8 = true } = {}) {
  const skill = getEvasionSkill(actor);
  const level = skill?.system?.level;
  if (level === null || level === "" || typeof level === "boolean") return false;
  if (!Number.isFinite(Number(level)) || Number(level) < 0) return false;
  const ref = actor?.system?.stats?.ref?.value;
  return !enforceRef8 || (Number.isFinite(Number(ref)) && Number(ref) >= 8) || hasReflexCoProcessor(actor);
}

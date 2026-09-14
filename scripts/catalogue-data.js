/** Pure, guarded catalogue updates. No fuzzy matching or changes to pack IDs. */
export const CATALOGUE_VERSION = '2026-09-14';
const ID = 'cpr-addenda';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const readPath = (data, path) => path.split('.').reduce((v, k) => v?.[k], data);
export function writePath(data, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((v, k) => (v[k] ??= {}), data);
  parent[last] = clone(value);
}
export function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}
export function catalogueSource(data, pack) {
  if (pack) return `Compendium.${pack}.Item.${data._id ?? data.id}`;
  return data._stats?.compendiumSource || data.flags?.core?.sourceId || '';
}
export function catalogueEntry(data, entries, pack, actor) {
  const source = catalogueSource(data, pack);
  const entry = entries.get(source);
  if (entry?.type === data.type) return entry;
  if (source) return null;
  const part = data.flags?.[ID]?.pktPart;
  if (!part || !Number.isInteger(part.slot)) return null;
  const frame = actor?.items?.get(part.frame);
  const parent = entries.get(catalogueSource(frame ?? {}));
  const nested = parent?.kitParts?.find(p => p.slot === part.slot && p.type === data.type);
  return nested ?? null;
}
/** Effects are matched by stable ID; changed changes/flags and custom effects survive.
 * Backups record only actual writes, once, including explicit null/false/zero values. */
export function catalogueUpdate(data, entry, { russian = true, compendium = false } = {}) {
  if (!entry || entry.type !== data.type) return null;
  const previousState = data.flags?.[ID]?.catalogue;
  const update = {}, backups = Array.isArray(previousState?.backups) ? clone(previousState.backups) : [];
  // Foundry expands dotted keys recursively inside objects. Store paths as
  // string values, and original payloads as JSON so their own dotted keys survive.
  const legacyBackups = previousState?.legacyBackups ??
    (previousState?.backups && !Array.isArray(previousState.backups) ? previousState.backups : undefined);
  let effects;
  for (const patch of entry.patches) {
    if (patch.compendiumOnly && !compendium) continue;
    if (patch.text && !russian) continue;
    const match = /^effects\.([^.]+)\.(.+)$/.exec(patch.path);
    let current;
    if (match) {
      const effect = (data.effects ?? []).find(e => e._id === match[1]);
      if (!effect) continue;
      current = readPath(effect, match[2]);
    } else current = readPath(data, patch.path);
    if (sameValue(current, patch.after) || !patch.before.some(value => sameValue(value, current))) continue;
    if (patch.path === 'system.consumed' && !(effects ?? data.effects ?? []).some(e => e.name === patch.after)) continue;
    if (!backups.some(backup => backup.path === patch.path)) backups.push({path:patch.path,valueJson:JSON.stringify(current)});
    if (match) {
      effects ??= clone(data.effects);
      writePath(effects.find(e => e._id === match[1]), match[2], patch.after);
    } else if (patch.path==='effects') effects=clone(patch.after);
    else update[patch.path] = clone(patch.after);
  }
  if (effects) update.effects = effects;
  if (!Object.keys(update).length) return null;
  update[`flags.${ID}.catalogue`] = {
    version: CATALOGUE_VERSION, source: entry.uuid, sources: clone(entry.sources), backups,
    ...(legacyBackups ? {legacyBackups:clone(legacyBackups)} : {}),
  };
  return update;
}

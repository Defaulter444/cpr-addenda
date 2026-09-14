import { catalogueEntry, catalogueUpdate } from './catalogue-data.js';
import { catalogueAmmoRepair, registerCatalogueWeaponControls } from './catalogue-weapons.js';
const ID = 'cpr-addenda';
let entries = new Map();
let loading;
export function loadCatalogue() {
  return loading ??= (async () => {
    const response = await fetch(`modules/${ID}/data/catalogue.json`);
    if (!response.ok) throw new Error(`Catalogue: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.entries)) throw new Error('Catalogue: missing entries');
    const next = new Map(data.entries.map(entry => [entry.uuid, entry]));
    if (next.size !== data.entries.length) throw new Error('Catalogue: duplicate source UUID');
    entries = next;
    return data;
  })();
}
function projectDocument(document, pack) {
  if (!document || document.documentName !== 'Item') return document;
  const data = document.toObject();
  const entry = catalogueEntry(data, entries, pack, document.actor ?? document.parent);
  const update = catalogueUpdate(data, entry, { russian: game.i18n.lang === 'ru', compendium:Boolean(pack) });
  if (update) document.updateSource(update);
  return document;
}
function projectIndex(pack) {
  if (game.i18n.lang !== 'ru' || pack.documentName !== 'Item') return;
  for (const index of pack.index) {
    const entry = entries.get(`Compendium.${pack.collection}.Item.${index._id}`);
    const name = entry?.patches.find(p => p.path === 'name');
    if (name && name.before.includes(index.name)) index.name = name.after;
  }
}
/** Read projection goes after Babele and preserves the original document instance.
 * Neither the system database nor another module's LevelDB packs are rewritten. */
export function registerCatalogue() {
  registerCatalogueWeaponControls();
  const load = () => loadCatalogue().catch(error => {
    console.error(`${ID} | catalogue`, error);
    throw error;
  });
  for (const method of ['getDocument', 'getDocuments']) {
    libWrapper.register(ID, `CompendiumCollection.prototype.${method}`, async function (wrapped, ...args) {
      if (this.documentName !== 'Item') return wrapped(...args);
      await load();
      const result = await wrapped(...args);
      if (Array.isArray(result)) result.forEach(doc => projectDocument(doc, this.collection));
      else projectDocument(result, this.collection);
      projectIndex(this);
      return result;
    }, 'WRAPPER');
  }
  libWrapper.register(ID, 'CompendiumCollection.prototype.getIndex', async function (wrapped, ...args) {
    if (this.documentName !== 'Item') return wrapped(...args);
    await load();
    const result = await wrapped(...args);
    projectIndex(this);
    return result;
  }, 'WRAPPER');
  Hooks.on('babele.ready', async () => {
    try { await load(); for (const pack of game.packs) projectIndex(pack); }
    catch (error) { console.error(`${ID} | catalogue index`, error); }
  });
  Hooks.on('preCreateItem', item => projectDocument(item));
  // The older RU migration can finish after ready. Upgrade its known text writes
  // in the same transaction, so it cannot restore an obsolete description.
  Hooks.on('preUpdateItem', (item, changes) => {
    if (!foundry.utils.hasProperty(changes, 'flags.cyberpunk-red-ru.textBeforeReview20260913')) return;
    const next = foundry.utils.mergeObject(item.toObject(), changes, { inplace: false });
    const entry = catalogueEntry(next, entries, undefined, item.actor ?? item.parent);
    const update = catalogueUpdate(next, entry, { russian: game.i18n.lang === 'ru' });
    if (update) foundry.utils.mergeObject(changes, update);
  });
}
export async function migrateCatalogue() {
  const data = await loadCatalogue();
  for (const pack of game.packs) projectIndex(pack);
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return { items: 0, entries: data.entries.length };
  const changed = [];
  const makeUpdate = item => {
    const source = item.toObject();
    const entry = catalogueEntry(source, entries, undefined, item.actor ?? item.parent);
    const update = catalogueUpdate(source, entry, { russian: game.i18n.lang === 'ru' });
    const repair = catalogueAmmoRepair(item);
    const patch = update || repair ? {...update,...repair} : null;
    if (!patch) return null;
    changed.push(item.uuid);
    return { _id: item.id, ...patch };
  };
  const world = game.items.map(makeUpdate).filter(Boolean);
  if (world.length) await Item.updateDocuments(world);
  const actors = new Map(game.actors.map(actor => [actor.uuid, actor]));
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
  }
  for (const actor of actors.values()) {
    const updates = actor.items.map(makeUpdate).filter(Boolean);
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  }
  if (changed.length) ui.notifications.info(`Addenda: обновлено ${changed.length} стандартных предметов. Прежние значения сохранены.`);
  return { items: changed.length, entries: data.entries.length, changed };
}
export async function catalogueStatus() {
  const data = await loadCatalogue();
  return { version: data.version, coverage: data.coverage, entries: data.entries.map(e => ({
    uuid: e.uuid, name: e.name, type: e.type, sources: e.sources, checks: e.checks,
  })) };
}

import { ID, copy } from './area-rules.js';
const SYS = 'cyberpunk-red-core';
const originalName = item => item.getFlag?.('babele', 'originalName') ?? item.name;
export function installedCyberware(actor) {
  const pending = [...(actor.system.installedItems?.list ?? [])], ids = new Set();
  while (pending.length) {
    const id = pending.pop(); if (ids.has(id)) continue; ids.add(id);
    pending.push(...(actor.items.get(id)?.system.installedItems?.list ?? []));
  }
  return actor.items.filter(i => i.type === 'cyberware' && ids.has(i.id));
}
export function empCandidates(actor) {
  const implanted = new Set(installedCyberware(actor).map(i => i.id));
  const items = actor.items.contents;
  const hardened = item => {
    const pending=[item], seen=new Set();
    while(pending.length) {
      const current=pending.pop(); if(seen.has(current.id)) continue; seen.add(current.id);
      if(current.system.providesHardening) return true;
      if((current.system.installedItems?.list ?? []).some(id=>actor.items.get(id)?.system.providesHardening)) return true;
      pending.push(...items.filter(i=>i.system.installedItems?.list?.includes(current.id)));
    }
    return false;
  };
  return items.filter(i => (implanted.has(i.id) || (i.system.isElectronic && ['carried','equipped'].includes(i.system.equipped))) && !empDisabled(i) && !hardened(i));
}
export function gasProtection(actor, type) {
  if (!['biotoxin','poison','sleep'].includes(type)) return false;
  return installedCyberware(actor).some(i => !empDisabled(i) && /^(Nasal Filters|Назальные фильтры)$/i.test(originalName(i))) ||
    actor.items.some(i => i.system.equipped === 'equipped' && /^(Gas Mask|Противогаз)$/i.test(originalName(i)));
}
export function resistanceSkill(actor, kind) {
  const names = kind === 'cybertech' ? ['Cybertech', 'Кибертехника'] : ['Resist Torture/Drugs', 'Сопротивление пыткам/наркотикам', 'Сопротивление пыткам и наркотикам'];
  const key = kind === 'cybertech' ? 'cybertech' : 'resistTortureDrugs';
  names.push(game.i18n.localize(`CPR.global.itemType.skill.${key}`));
  return actor.itemTypes.skill.find(i => names.some(n => n.toLowerCase() === originalName(i).toLowerCase() || n.toLowerCase() === i.name.toLowerCase()));
}
async function timedEffect(actor, key, name, changes = [], statuses = []) {
  const existing = actor.effects.find(e => e.flags?.[ID]?.areaEffect === key);
  const flags = { [ID]: { areaEffect: key, expires: game.time.worldTime + 60 },
    [SYS]: { changes: { cats: Object.fromEntries(changes.map((_, i) => [i, 'skill'])),
      situational: Object.fromEntries(changes.map((_, i) => [i, { isSituational: false, onByDefault: true }])) } } };
  const data = { name, img: 'icons/svg/aura.svg', changes, statuses, flags,
    duration: { seconds: 60, startTime: game.time.worldTime } };
  if (existing) return existing.update(data);
  return (await actor.createEmbeddedDocuments('ActiveEffect', [data]))[0];
}
async function temporaryInjury(actor, name) {
  const pack = game.packs.get(`${SYS}.core_critical-injuries-head`);
  const docs = await pack.getDocuments();
  const names = name === 'Damaged Eye' ? ['Damaged Eye', 'Повреждение глаза'] : ['Damaged Ear', 'Повреждение уха'];
  const source = docs.find(d => names.includes(originalName(d)) || names.includes(d.name));
  if (!source) throw new Error(`В компендиуме не найдена травма: ${name}`);
  // An existing permanent injury is never converted into a temporary one.
  const existing = actor.items.find(i => i.type === 'criticalInjury' && i.name === source.name);
  if (existing) {
    if (existing.flags?.[ID]?.temporaryAreaInjury) await existing.setFlag(ID, 'expires', game.time.worldTime + 60);
    return;
  }
  const data = source.toObject(); delete data._id; delete data.folder;
  data.flags ??= {}; data.flags[ID] = { temporaryAreaInjury: true, expires: game.time.worldTime + 60 };
  await actor.createEmbeddedDocuments('Item', [data]);
}
export async function applySpecial(actor, effect, { empIds = [], penetrated = false } = {}) {
  if (effect === 'fire' && penetrated) {
    const existing = actor.effects.find(e => e.flags?.[ID]?.areaFire);
    if (!existing) await actor.createEmbeddedDocuments('ActiveEffect', [{ name: 'Горение — 2 ПЗ в конце хода',
      img: 'icons/svg/fire.svg', flags: { [ID]: { areaFire: true } } }]);
  }
  if (['flashbang', 'teargas'].includes(effect)) {
    const cyber = installedCyberware(actor).filter(i => !empDisabled(i));
    if (effect === 'teargas' || !cyber.some(i => /Anti.Dazzle|Защита от (вспыш|ослеп)|Антиблик/i.test(originalName(i)))) await temporaryInjury(actor, 'Damaged Eye');
    if (effect === 'flashbang' && !cyber.some(i => /Level Damper|Защита от громк|Поглотитель звука|Ограничитель громкости/i.test(originalName(i)))) await temporaryInjury(actor, 'Damaged Ear');
  }
  if (effect === 'sleep') {
    const unconscious = CONFIG.statusEffects.find(e => /unconscious|без сознания/i.test(`${e.id} ${e.name} ${game.i18n.localize(e.name ?? e.label ?? '')}`));
    const prone = CONFIG.statusEffects.find(e => /prone|л[её]жа/i.test(`${e.id} ${e.name} ${game.i18n.localize(e.name ?? e.label ?? '')}`));
    await timedEffect(actor, 'sleep', 'Усыпляющая граната — без сознания', [], [unconscious?.id].filter(Boolean));
    if(prone) await actor.toggleStatusEffect(prone.id,{active:true});
  }
  if (effect === 'emp') {
    const candidates = empCandidates(actor);
    if (empIds.length > 2 || empIds.some(id => !candidates.some(i => i.id === id))) throw new Error('ЭМИ: выберите до двух установленных имплантов или носимых электронных предметов.');
    for (const id of empIds) {
      const item = actor.items.get(id);
      await item.setFlag(ID, 'empUntil', game.time.worldTime + 60);
      for(const effect of item.effects) if(!effect.disabled) await effect.update({disabled:true,[`flags.${ID}.empDisabled`]:true});
      for(const child of actor.items) if(child.id!==item.id && empDisabled(child)) for(const effect of child.effects) if(!effect.disabled) await effect.update({disabled:true,[`flags.${ID}.empDisabled`]:true});
    }
  }
}
export async function rollBodyInjury(actor) {
  const setting = game.settings.get(SYS, 'criticalInjuryRollTableCompendium');
  const tables = await game.packs.get(setting).getDocuments();
  const table = tables.find(t => /Critical Injuries \(Body\)|Критические травмы тела|Критические повреждения.*тела/i.test(`${originalName(t)} ${t.name}`));
  if (!table) throw new Error('Не найдена таблица критических травм тела.');
  const injuries = await game.packs.get(`${SYS}.core_critical-injuries-body`).getDocuments();
  for (let n = 0; n < 100; n++) {
    const { roll, results } = await table.roll();
    const result = results[0];
    const source = injuries.find(i => i.id === result?.documentId || i.name === result?.text || originalName(i) === result?.text);
    if (!source) throw new Error('Результат таблицы не связан с предметом критической травмы.');
    if (game.settings.get(SYS, 'preventDuplicateCriticalInjuries') === 'reroll' && actor.items.some(i => i.type === 'criticalInjury' && i.name === source.name)) continue;
    const data = source.toObject(); delete data._id; delete data.folder;
    await actor.createEmbeddedDocuments('Item', [data]);
    return { name: source.name, roll: roll.total };
  }
  return { name: 'Все доступные травмы уже получены' };
}
export async function expireAreaEffects() {
  if (game.user.id !== game.users.activeGM?.id) return;
  const actors = new Map(game.actors.map(a => [a.uuid, a]));
  for (const scene of game.scenes) for (const token of scene.tokens) if (token.actor) actors.set(token.actor.uuid, token.actor);
  for (const actor of actors.values()) {
    const expired = actor.effects.filter(e => e.flags?.[ID]?.expires <= game.time.worldTime).map(e => e.id);
    if (expired.length) await actor.deleteEmbeddedDocuments('ActiveEffect', expired);
    const injuries = actor.items.filter(i => i.flags?.[ID]?.temporaryAreaInjury && i.flags[ID].expires <= game.time.worldTime).map(i => i.id);
    if (injuries.length) await actor.deleteEmbeddedDocuments('Item', injuries);
    for (const item of actor.items) if (item.flags?.[ID]?.empUntil <= game.time.worldTime) await item.unsetFlag(ID, 'empUntil');
    for(const item of actor.items) if(!empDisabled(item)) for(const effect of item.effects) if(effect.flags?.[ID]?.empDisabled) await effect.update({disabled:false,[`flags.${ID}.-=empDisabled`]:null});
  }
  for(const scene of game.scenes) {
    const ids=scene.templates.filter(t=>t.flags?.[ID]?.expires <= game.time.worldTime).map(t=>t.id);
    if(ids.length) await scene.deleteEmbeddedDocuments('MeasuredTemplate',ids);
  }
}
/** Gate the item and its descendants while EMP is active. Data stays installed. */
export function empDisabled(item) {
  if (item.flags?.[ID]?.empUntil > game.time.worldTime) return true;
  const actor = item.actor;
  if (!actor) return false;
  const seen = new Set(), pending = [item.id];
  while (pending.length) {
    const id = pending.pop(); if (seen.has(id)) continue; seen.add(id);
    for (const parent of actor.items) if (parent.system.installedItems?.list?.includes(id)) {
      if (parent.flags?.[ID]?.empUntil > game.time.worldTime) return true;
      pending.push(parent.id);
    }
  }
  return false;
}

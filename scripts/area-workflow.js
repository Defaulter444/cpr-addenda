/** One persisted attack, one GM queue, one damage roll. No global last-target cache.
 * Inspired by MMuton's Better Grenades inventory/card flow (permission from author
 * reported by the project owner). Rules and damage resolution are implemented here
 * against CPR 0.92.4, rather than its independent HP/armor implementation. */
import { ID, BLAST, SHOT, copy, areaGeometry, intersects, sceneScale, rangedDV, coverOutcome, effectiveTargets, snapshotAreaAttack } from './area-rules.js';
import { canEvadeRanged, getEvasionSkill } from './ranged-evasion.js';
import { resistanceSkill, applySpecial, empCandidates, rollBodyInjury, expireAreaEffects, gasProtection } from './area-effects.js';
import { catalogueFireProtection } from './catalogue-rules.js';
const SYS = 'cyberpunk-red-core';
const esc = value => Handlebars.escapeExpression(String(value ?? ''));
let socket, queue = Promise.resolve();
const busy = new Set();
export const getArea = message => message?.flags?.[ID]?.area;
export function tokenOf(actor, tokenId) {
  if (tokenId) return canvas.scene?.tokens.get(tokenId)?.object ?? null;
  if (actor?.isToken) return actor.token?.object ?? null;
  return canvas.tokens?.controlled.find(t => t.actor === actor) ?? canvas.tokens?.placeables.find(t => t.actor === actor) ?? null;
}
export function sightBlocked(from, to, type = 'sight') {
  return Boolean(CONFIG.Canvas.polygonBackends[type]?.testCollision(from, to, { type, mode: 'any' }));
}
function requireGM() {
  if (!game.users.activeGM) throw new Error('Для разрешения площадной атаки нужен подключённый мастер.');
}
export async function requestAction(messageId, action, data = {}) {
  requireGM();
  if (socket) return socket.executeAsUser('areaAction', game.users.activeGM.id, { messageId, action, data });
  if (game.user.isGM) return enqueue({ messageId, action, data }, game.user.id);
  throw new Error('Для кнопок игроков включите socketlib. Мастер может разрешить атаку на своей карточке.');
}
function enqueue(request, userId) {
  const result = queue.then(() => resolveAction(request, userId));
  queue = result.catch(() => {}); return result;
}
export function registerAreaWorkflow() {
  if (globalThis.socketlib && game.modules.get('socketlib')?.active) {
    socket = socketlib.registerModule(ID);
    socket.register('areaAction', function (request) { return enqueue(request, this.socketdata.userId); });
    socket.register('consumeGrenade', function (uuid) {
      const caller = this.socketdata.userId;
      const result = queue.then(async () => {
        const item = await fromUuid(uuid), user = game.users.get(caller);
        if (!item || item.type !== 'ammo' || item.system.variety !== 'grenade' || !item.testUserPermission(user, 'OWNER')) throw new Error('Нет доступа к гранате.');
        if (Number(item.system.amount) < 1) throw new Error('Гранаты закончились.');
        await item.update({ 'system.amount': item.system.amount - 1 });
      });
      queue = result.catch(() => {}); return result;
    });
  }
  Hooks.on('updateWorldTime', () => expireAreaEffects().catch(reportError));
  Hooks.on('updateCombat', (combat, change) => {
    if (game.user.id !== game.users.activeGM?.id || (!('turn' in change) && !('round' in change))) return;
    // Foundry's previous turn is the actor whose turn just ended.
    const prev = combat.previous, combatant = combat.combatants.get(prev?.combatantId);
    const actor = combatant?.actor;
    if (!actor || !actor.effects.some(e => e.flags?.[ID]?.areaFire)) return;
    queue = queue.then(async () => {
      const key = `${combat.id}:${prev.round}:${prev.turn}`;
      if (actor.getFlag(ID, 'areaFireTick') === key) return;
      const fires = actor.effects.filter(e => e.flags?.[ID]?.areaFire);
      if (!fires.length || catalogueFireProtection(actor,game.time.worldTime)) return;
      const damage = Math.max(...fires.map(e => e.flags[ID].areaFireDamage === 4 ? 4 : 2));
      await actor.update({ 'system.derivedStats.hp.value': actor.system.derivedStats.hp.value - damage, [`flags.${ID}.areaFireTick`]: key });
      await ChatMessage.create({ content: `<p>${esc(actor.name)}: горение, −${damage} ПЗ (броня не применяется). Для тушения потратьте действие и снимите эффект горения.</p>` });
    }).catch(reportError);
  });
  Hooks.on('preUpdateActor', (actor, changes) => {
    const hp = foundry.utils.getProperty(changes, 'system.derivedStats.hp.value');
    if (!actor.isOwner || !(hp < actor.system.derivedStats.hp.value)) return;
    const ids = actor.effects.filter(e => e.flags?.[ID]?.areaEffect === 'sleep').map(e => e.id);
    if (ids.length) actor.deleteEmbeddedDocuments('ActiveEffect', ids).catch(reportError);
  });
}
function reportError(error) { console.error(`${ID} | AOE`, error); ui.notifications.error(error.message ?? String(error)); }
export async function createAreaAttack({ item, actor, roll, snapshot, shooter, aimPoint = null }) {
  const s = snapshot ?? snapshotAreaAttack(item, /autofire/.test(roll.rollCard) ? 'autofire' : 'attack');
  if (!canvas.scene || !shooter) throw new Error('Поставьте и выберите токен атакующего на сцене.');
  roll.criticalCard = roll.wasCritical();
  const area = { version: 2, ...s, name: item.name, weapon: item.uuid, shooter: actor.uuid,
    sourceToken: shooter.document.uuid, scene: canvas.scene.uuid, origin: copy(shooter.center),
    rotation: Number(shooter.document.rotation) || 0, attack: Number(roll.resultTotal),
    targets: [], phase: 'placement', template: null, damage: null, revision: 0,
    attackHtml: await renderTemplate(roll.rollCard, roll) };
  // The native attack button causes independent evasion/damage workflows in two
  // installed modules. Area attacks have their own resolution buttons instead.
  const attackHTML = document.createElement('div'); attackHTML.innerHTML = area.attackHtml;
  attackHTML.querySelectorAll('[data-action="rollDamage"]').forEach(e => e.remove());
  area.attackHtml = attackHTML.innerHTML;
  if (item.system.quality === 'poor' && roll.wasCritFail() && !roll.fumbleRecovery) {
    area.weaponFailure = item.system.critFailEffect ?? 'jammed';
    if (area.weaponFailure === 'jammed') await item.setFlag(ID, 'areaJammed', true);
  }
  const message = await ChatMessage.create(ChatMessage.applyRollMode({ speaker: ChatMessage.getSpeaker({ actor, token: shooter.document }),
    content: renderCard(area), flags: { [ID]: { area } } }, 'roll'));
  if (s.kind === SHOT) {
    const point = aimPoint ?? { x: area.origin.x + Math.cos(area.rotation * Math.PI / 180) * 100, y: area.origin.y + Math.sin(area.rotation * Math.PI / 180) * 100 };
    await requestAction(message.id, 'place', { point });
  } else if (aimPoint) await requestAction(message.id, 'place', { point: aimPoint });
  return message;
}
async function updateCard(message, area) {
  area.revision++;
  await message.update({ [`flags.${ID}.area`]: area, content: renderCard(area) });
}
function owned(user, document) { return user?.isGM || document?.testUserPermission(user, 'OWNER'); }
async function rollDefense(roll, actor, data) {
  const luck=Number(data.luck ?? 0), modifier=Number(data.modifier ?? 0);
  if(!Number.isInteger(luck)||luck<0||luck>Number(actor.system.stats.luck?.value ?? 0)||!Number.isFinite(modifier)||Math.abs(modifier)>100) throw new Error('Недопустимые значения удачи или модификатора.');
  roll.luck=luck;
  if(modifier) roll.addMod([{value:modifier,source:'Обстоятельства (введено при защите)'}]);
  if(luck) await actor.update({'system.stats.luck.value':actor.system.stats.luck.value-luck});
  await roll.roll(); return roll;
}
async function sceneFor(area) {
  const scene = await fromUuid(area.scene);
  if (!scene || canvas.scene?.id !== scene.id) throw new Error('Откройте сцену этой атаки перед разрешением зоны.');
  return scene;
}
async function distanceDV(area, scene, point) {
  const scale = sceneScale(scene.grid);
  const distance = canvas.grid.measurePath([area.origin, point]).distance / scale.units;
  let rows = null;
  if (area.dvTable && area.kind !== SHOT && !area.thrown) {
    const { default: utils } = await import(`/systems/${SYS}/modules/utils/cpr-systemUtils.js`);
    const tables = await utils.GetDvTables();
    const table = tables.find(t => t.name === area.dvTable);
    if (!table) throw new Error(`Не найдена таблица дальности «${area.dvTable}». Исправьте таблицу оружия.`);
    rows = table.results.contents.map(r => ({ range: r.range, text: r.text })).sort((a, b) => a.range[1] - b.range[1]);
  }
  return { distance, dv: rangedDV(distance, area, rows) };
}
export async function validateAreaAim(snapshot, actor, point) {
  const shooter = tokenOf(actor);
  if (!shooter || !canvas.scene) throw new Error('Выберите токен атакующего на сцене.');
  if (![point?.x,point?.y].every(Number.isFinite)) throw new Error('Выберите точку на сцене.');
  // A shell click selects a direction; its area always starts at the muzzle.
  if (snapshot.kind === SHOT) return;
  const {dv} = await distanceDV({...snapshot, origin:shooter.center}, canvas.scene, point);
  if (dv == null) throw new Error('Точка находится вне дальности оружия. Боеприпас не израсходован.');
}
function collectTargets(area, geometry) {
  return canvas.tokens.placeables.filter(t => t.actor && ['character', 'mook', 'container'].includes(t.actor.type) && intersects(t, geometry.hit))
    .filter(t => area.kind !== SHOT || (t.document.uuid !== area.sourceToken && !sightBlocked(area.origin, t.center)))
    .map(t => {
      const previous = area.targets.find(row => row.uuid === t.document.uuid);
      const canDodge = ['character', 'mook'].includes(t.actor.type) && canEvadeRanged(t.actor);
      const coverUnknown = area.kind === BLAST && sightBlocked(area.blastCentre, t.center, 'move');
      const immune = area.profile.delivery!=='liquid' && gasProtection(t.actor, area.profile.type);
      return previous ?? { uuid: t.document.uuid, name: t.name, canDodge, defense: canDodge ? 'pending' : 'hit',
        coverHp: coverUnknown ? null : 0, shield: false, excluded: immune, immunity: immune ? 'Назальные фильтры / противогаз' : null, applied: false };
    });
}
async function place(area, point, scene, scatter = false) {
  if (![point?.x, point?.y].every(Number.isFinite)) throw new Error('Выберите точку на сцене.');
  if (scatter) {
    const radius = sceneScale(scene.grid).pixels * 5;
    if (Math.abs(point.x - area.aimPoint.x) > radius || Math.abs(point.y - area.aimPoint.y) > radius) throw new Error('При промахе мастер выбирает точку внутри квадрата 10 × 10 м вокруг исходной цели.');
  } else {
    const range = await distanceDV(area, scene, point);
    if (area.kind !== SHOT && range.dv == null) throw new Error('Точка находится вне дальности оружия (бросок гранаты — до 25 м).');
    Object.assign(area, range, { aimPoint: copy(point) });
    if (area.kind === SHOT) { area.dv = 13; area.distance = 6; }
  }
  const direction = Math.atan2(point.y - area.origin.y, point.x - area.origin.x) * 180 / Math.PI;
  const geometry = areaGeometry(area.kind, scene.grid, area.kind === SHOT ? area.origin : point, direction);
  area.blastCentre = copy(point); area.geometry = geometry;
  if (area.template) {
    const template = await fromUuid(area.template);
    if (template) await template.update(geometry.template);
  } else {
    const [template] = await scene.createEmbeddedDocuments('MeasuredTemplate', [{ ...geometry.template, user: game.user.id,
      fillColor: area.kind === SHOT ? '#ffa53d' : '#d63845', borderColor: '#202020',
      flags: { [ID]: { area: area.kind } } }]);
    area.template = template.uuid;
  }
  if (area.kind === SHOT && area.attack <= 13) {
    area.phase = 'miss'; area.targets = [];
    const template = await fromUuid(area.template); if (template) await template.delete(); area.template = null;
    return;
  }
  area.phase = !scatter && area.kind === BLAST && area.attack <= area.dv ? 'scatter' : 'defenses';
  if(area.phase==='scatter' && area.profile.type==='smart' && !area.smartAttempt && area.dv-area.attack<=4) area.phase='smart';
  area.targets = ['scatter','smart'].includes(area.phase) ? [] : collectTargets(area, geometry);
}
export async function resolveAction({ messageId, action, data = {} }, userId) {
  if (!game.user.isGM) throw new Error('Разрешение зоны выполняет мастер.');
  const message = game.messages.get(messageId), area = copy(getArea(message));
  if (!area || area.version !== 2) throw new Error('Эта карточка создана старой версией Addenda; выполните новую атаку.');
  const user = game.users.get(userId), shooter = await fromUuid(area.shooter);
  if (!user) throw new Error('Пользователь не найден.');
  const attacking = owned(user, shooter);
  const row = area.targets.find(t => t.uuid === data.uuid);
  const target = row ? await fromUuid(row.uuid) : null;
  const defend = row && owned(user, target?.actor);
  if (!user.isGM && !(['dodge','take','dodgeMove','save'].includes(action) ? defend : attacking)) throw new Error('Нет прав на это действие.');
  if (['apply','cover','exclude','scatter','emp','injury'].includes(action) && !user.isGM) throw new Error('Это решение принимает мастер.');
  if (['done', 'miss'].includes(area.phase) && !['injury','unjam','dodgeMove'].includes(action)) return { complete: true };
  const scene = await sceneFor(area);
  if (action === 'unjam') {
    const weapon = await fromUuid(area.weapon);
    if (weapon && area.weaponFailure === 'jammed') { await weapon.unsetFlag(ID, 'areaJammed'); area.weaponFailure = null; }
  } else if (action === 'place') {
    if (area.phase !== 'placement') return;
    await place(area, data.point, scene);
  } else if (action === 'smart') {
    if(area.phase!=='smart'||area.smartAttempt)return;
    const {CPRRoll}=await import(`/systems/${SYS}/modules/rolls/cpr-rolls.js`);
    const roll=new CPRRoll('Донаведение умной ракеты','1d10');roll.addMod([{value:10,source:'Умный боеприпас'}]);
    await rollDefense(roll,shooter,{...data,modifier:0});
    area.smartAttempt={original:area.attack,total:roll.resultTotal};area.attack=roll.resultTotal;
    await place(area,area.aimPoint,scene);
  } else if (action === 'scatter') {
    if (area.phase !== 'scatter') return;
    await place(area, data.point, scene, true);
  } else if (action === 'recount') {
    if (area.phase !== 'defenses' || area.damage || area.targets.some(t => t.defenseRoll != null || t.applied)) throw new Error('После защит или урона состав зоны зафиксирован.');
    const template = await fromUuid(area.template);
    if (!template) throw new Error('Шаблон удалён; повторите атаку.');
    // Do not let dragging move shells away from the muzzle or move a hit blast.
    await template.update(area.geometry.template);
    area.targets = collectTargets(area, area.geometry);
  } else if (action === 'dodge' || action === 'take') {
    if (!row || row.applied || row.defense !== 'pending' || area.phase !== 'defenses') return;
    if (action === 'take') row.defense = 'hit';
    else {
      if (!canEvadeRanged(target.actor)) throw new Error('Цель не может уклоняться от дальнобойных атак.');
      const skill = getEvasionSkill(target.actor);
      const roll = skill.createRoll('skill', target.actor);
      if (area.evasionModifier) roll.addMod([{ value: area.evasionModifier, source: 'Автоматическая дробь' }]);
      await rollDefense(roll,target.actor,data);
      row.defenseRoll = roll.resultTotal;
      // Explosives explicitly require a roll HIGHER than the original attack.
      row.defense = (area.kind === BLAST ? roll.resultTotal > area.attack : roll.resultTotal >= area.attack) ? 'dodged' : 'hit';
    }
  } else if (action === 'dodgeMove') {
    if (!row || row.defense !== 'dodged' || row.moved || area.kind !== BLAST) return;
    const p = data.point, h = area.geometry.hit, margin = sceneScale(scene.grid).pixels * 2;
    if (![p?.x,p?.y].every(Number.isFinite) || p.x < h.x-margin || p.y < h.y-margin || p.x > h.x+h.size+margin || p.y > h.y+h.size+margin) throw new Error('Выберите клетку непосредственно за пределами взрыва.');
    const position = { x:p.x-target.width*scene.grid.size/2, y:p.y-target.height*scene.grid.size/2 };
    if (intersects({ document: {...position,width:target.width,height:target.height,parent:scene} }, h)) throw new Error('Токен должен полностью выйти из зоны взрыва.');
    if (sightBlocked(target.object.center,p,'move')) throw new Error('Перемещение через стену невозможно. Выберите другую клетку.');
    await target.update(position); row.moved = true;
  } else if (action === 'cover') {
    if (!row || row.applied || area.damage) return;
    if (!Number.isFinite(data.hp) || data.hp < 0) throw new Error('ПЗ укрытия должны быть неотрицательным числом.');
    row.coverHp = data.hp; row.shield = Boolean(data.shield);
  } else if (action === 'exclude') {
    if (!row || row.applied || area.damage) return;
    row.excluded = !row.excluded;
  } else if (action === 'save') {
    if (!row || row.applied || row.save || !area.profile.resistance || row.defense === 'pending') return;
    const skill = resistanceSkill(target.actor, area.profile.resistance.skill);
    if (!skill) throw new Error(`У ${target.name} отсутствует навык сопротивления.`);
    const roll = skill.createRoll('skill', target.actor); await rollDefense(roll,target.actor,data);
    row.save = { total: roll.resultTotal, passed: roll.resultTotal > area.profile.resistance.dv };
  } else if (action === 'emp') {
    if (!row || row.applied) return;
    const candidates = empCandidates(target.actor), ids = data.ids ?? [];
    if (ids.length > 2 || ids.some(id => !candidates.some(i => i.id === id))) throw new Error('Недопустимый выбор целей ЭМИ.');
    row.empIds = ids;
  } else if (action === 'damage') {
    if (area.phase !== 'defenses' || area.damage) return;
    if (effectiveTargets(area).some(t => t.defense === 'pending' || t.coverHp == null)) throw new Error('Сначала разрешите уклонения и неизвестные укрытия.');
    if (area.profile.mode === 'manual') throw new Error('Особый боеприпас: примените его отдельное книжное правило. Автоматический урон отключён.');
    await rollAreaDamage(area);
  } else if (action === 'apply') {
    if (!area.damage) throw new Error('Сначала бросьте общий урон/эффект.');
    if (effectiveTargets(area).some(t => t.defense === 'pending' || t.coverHp == null)) throw new Error('Защита ещё не разрешена.');
    if (area.profile.resistance && effectiveTargets(area).some(t => !t.save)) throw new Error('Сначала выполните проверки сопротивления.');
    if (area.profile.effect === 'emp' && effectiveTargets(area).some(t => !t.save?.passed && !Array.isArray(t.empIds))) throw new Error('Выберите предметы, которые отключит ЭМИ.');
    for (const targetRow of effectiveTargets(area)) {
      const document = await fromUuid(targetRow.uuid), actor = document?.actor;
      if (!actor) { targetRow.error = 'Токен удалён'; continue; }
      if (targetRow.applying) throw new Error('Предыдущее применение прервалось. Проверьте ПЗ цели перед новой атакой.');
      // Durable claim before actor mutation. A reconnect never repeats HP loss.
      targetRow.applying = true; await updateCard(message, area);
      try {
        await applyTarget(area, targetRow, actor);
        targetRow.applied = true; delete targetRow.applying;
        await updateCard(message, area);
      } catch (error) {
        targetRow.error = error.message; await updateCard(message, area); throw error;
      }
    }
    if (effectiveTargets(area).length === 0) {
      area.phase = 'done';
      const template = await fromUuid(area.template);
      if (template && area.profile.mode !== 'smoke') await template.delete();
      if (template && area.profile.mode === 'smoke') await template.setFlag(ID, 'expires', game.time.worldTime + 60);
    }
  } else if (action === 'injury') {
    if (!row || !row.needsInjury) return;
    await applyAreaInjuries(area,row,target.actor);
  } else throw new Error('Неизвестное действие площадной атаки.');
  await updateCard(message, area);
  return { phase: area.phase, revision: area.revision };
}
export async function rollAreaDamage(area) {
  const { CPRDamageRoll } = await import(`/systems/${SYS}/modules/rolls/cpr-rolls.js`);
  const p=area.profile;
  const one=async()=>{
    const roll=new CPRDamageRoll(area.name,p.formula,area.weaponType);
    if(p.mode==='damage')roll.addMod(p.mods??[]);
    await roll.roll();
    return {total:roll.resultTotal,formula:roll.formula,faces:[...roll.faces],critical:p.critical&&roll.wasCritical()};
  };
  if(p.perTargetDamage) {
    for(const row of effectiveTargets(area))row.damage=await one();
    area.damage={perTarget:true};
  } else area.damage=await one();
}
export async function applyAreaInjuries(area,row,actor,draw=rollBodyInjury) {
  if(!row.injury)row.injury=await draw(actor);
  if((area.profile.expansive || area.profile.type==='expansive') && row.injury.key==='Foreign Object' && !row.extraInjury) {
    row.extraInjury=await draw(actor,{exclude:['Foreign Object']});
  }
  row.needsInjury=false;
}
export async function applyTarget(area, row, actor) {
  const p = area.profile, damage = p.perTargetDamage ? row.damage : area.damage;
  if(!damage)throw new Error('Для этой цели ещё не брошен урон.');
  if (p.effect==='fire' && catalogueFireProtection(actor,game.time.worldTime)) { row.outcome='Пожарный костюм защищает от огня';return; }
  const cover = coverOutcome(area.kind, damage.total, row.coverHp, p.coverImmune);
  row.coverRemaining = cover.remaining;
  if (cover.blocked) { row.outcome = 'Укрытие остановило атаку'; return; }
  if (row.save?.passed) { row.outcome = 'Сопротивление успешно'; return; }
  const before = actor.system.derivedStats?.hp?.value;
  if (p.mode === 'damage') {
    if (row.shield) {
      const shields = actor.getEquippedArmors('shield');
      const hp = Math.max(0, ...shields.map(s => s.system.shieldHitPoints.value));
      if (hp > 0) {
        if (p.coverImmune) { row.outcome='Щит остановил атаку и не повреждён';return; }
        await actor._ablateArmor('shield', Math.min(hp, damage.total));
        if (area.kind === SHOT || damage.total < hp) { row.outcome = 'Щит остановил атаку'; return; }
      }
    }
    if (actor.type === 'container') {
      const sp = Math.max(0, Number(actor.system.externalData?.currentArmorBody?.value) || 0);
      const taken = Math.max(0, damage.total - sp);
      await actor.update({ 'system.derivedStats.hp.value': Math.max(0,before - taken),
        'system.externalData.currentArmorBody.value': taken > 0 ? Math.max(0,sp-p.ablation) : sp });
      row.hpBefore = before; row.hpAfter = actor.system.derivedStats.hp.value; row.outcome = 'Урон ПЗТ'; return;
    }
    const armors = actor.getEquippedArmors('body');
    const { default: actorUtils } = await import(`/systems/${SYS}/modules/utils/ActorUtils.js`);
    const sp = Math.max(0, ...await Promise.all(armors.map(i => actorUtils.calculateArmorSP(i, 'body', true))));
    const effectiveSP = sp < p.ignoreBelowSP ? 0 : Math.round(sp * (1 - p.ignoreArmorPercent / 100));
    const penetrated = damage.total > effectiveSP;
    await actor._applyDamage(damage.total, damage.critical ? 5 : 0, 'body', p.ablation,
      area.kind === BLAST ? (area.ammo.variety ?? 'grenade') : 'shotgunShell', p.ignoreArmorPercent, p.ignoreBelowSP, p.lethal,
      { damageReductionRole: true, damageReductionAE: true, useShield: false, brainDamageReduction: false });
    await applySpecial(actor, p.effect, { penetrated, fireDamage:p.fireDamage });
    if (damage.critical) {
      row.needsInjury = true;
      try { await applyAreaInjuries(area,row,actor); }
      catch (error) { row.injuryError = error.message; }
    }
  } else if (p.mode === 'direct') {
    if (!['character', 'mook'].includes(actor.type)) { row.outcome = 'Не является живой целью'; return; }
    await actor.update({ 'system.derivedStats.hp.value': before - damage.total });
  } else if (p.mode === 'acid') {
    if (row.shield && actor.getEquippedArmors('shield').some(s=>s.system.shieldHitPoints.value>0)) {
      await actor._ablateArmor('shield',1);row.outcome='Щит остановил жидкость';return;
    }
    await actor._ablateArmor('body',1);
    if (p.acidAllArmor) await actor._ablateArmor('head',1);
  }
  else await applySpecial(actor, p.effect, { empIds: row.empIds });
  row.hpBefore = before; row.hpAfter = actor.system.derivedStats?.hp?.value;
  row.outcome = p.mode === 'smoke' ? 'Дым: −4 к действиям, которым он мешает; 1 минута' : 'Применено';
}
function button(action, label, uuid = '', disabled = false) {
  return `<button type="button" data-aoe-action="${action}" data-token-uuid="${esc(uuid)}" ${['dodge','save'].includes(action) ? 'title="Shift + нажатие: удача и модификатор"' : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
}
export function renderCard(area) {
  const complete = ['done','miss'].includes(area.phase);
  const title = area.kind === SHOT ? 'Дробь · 6 × 6 м' : 'Взрыв · 10 × 10 м';
  const status = { placement: 'Выберите точку на сцене', scatter: 'Промах — мастер выбирает точку отклонения в исходном квадрате 10 × 10 м',
    smart: 'Умная ракета промахнулась не более чем на 4: донаведение 1d10 + 10 против той же СЛ',
    defenses: 'Разрешите защиту каждой цели', miss: 'Промах дробью — урон не наносится', done: 'Атака разрешена' }[area.phase];
  const roster = area.targets.map(t => {
    const state = t.excluded ? (t.immunity ?? 'Исключена мастером') : t.defense === 'dodged' ? `Уклонилась (${t.defenseRoll})` : t.defense === 'pending' ? 'Ожидает решения об уклонении' : `Попадание${t.defenseRoll != null ? ` · уклонение ${t.defenseRoll}` : ''}`;
    const defense = t.defense === 'pending' && !complete ? button('dodge','Уклониться',t.uuid) + button('take','Принять',t.uuid) : '';
    const special = area.profile.resistance && !complete && t.defense === 'hit' ? (t.save ? `<span>Сопротивление ${t.save.total}: ${t.save.passed ? 'успех' : 'провал'}</span>` : button('save',`Сопротивление · СЛ ${area.profile.resistance.dv}`,t.uuid)) : '';
    const emp = area.profile.effect === 'emp' && t.save && !t.save.passed && !complete ? button('emp',Array.isArray(t.empIds) ? `ЭМИ: выбрано ${t.empIds.length}` : 'Выбрать до 2 предметов',t.uuid) : '';
    const move = area.kind === BLAST && t.defense === 'dodged' && !t.moved ? button('dodgeMove','Переместить из зоны',t.uuid) : '';
    return `<li><strong>${esc(t.name)}</strong><br><span>${esc(state)}</span><div>${defense}${special}${emp}${move}</div>` +
      (!complete && !t.applied ? `<div class="aoe-gm">${button('cover',t.coverHp == null ? 'Укрытие: нужны ПЗ' : `Укрытие: ${t.coverHp} ПЗ${t.shield ? ' + щит' : ''}`,t.uuid, Boolean(area.damage))}${button('exclude',t.excluded ? 'Вернуть' : 'Исключить',t.uuid,Boolean(area.damage))}</div>` : '') +
      (t.damage ? `<p>Урон: ${t.damage.total} (${esc(t.damage.formula)}: ${t.damage.faces.join(', ')})${t.damage.critical?' · критическая травма и +5 ПЗ':''}</p>`:'') +
      (t.applied ? `<small>${esc(t.outcome)}${t.hpBefore !== t.hpAfter ? ` · ПЗ ${t.hpBefore} → ${t.hpAfter}` : ''}${t.coverHp > 0 ? ` · укрытие: ${t.coverRemaining} ПЗ` : ''}${t.injury ? ` · ${esc(t.injury.name)}` : ''}${t.extraInjury?` · ${esc(t.extraInjury.name)} (без второго бонусного урона)`:''}</small>` : '') +
      (t.error ? `<p>${esc(t.error)}</p>` : '') + (t.needsInjury ? button('injury','Назначить критическую травму',t.uuid) : '') + '</li>';
  }).join('');
  const damage = area.damage?.perTarget ? '<p>Урон брошен отдельно для каждой цели.</p>' : area.damage ? `<p><b>Общий урон: ${area.damage.total}</b> (${esc(area.damage.formula)}: ${area.damage.faces.join(', ')})${area.damage.critical ? ' · критическая травма и +5 ПЗ каждой цели' : ''}</p>` : '';
  return `<section class="cpr-addenda-aoe">${area.attackHtml ?? ''}<h3>${esc(area.name)} · ${title}</h3><p>Атака ${area.attack}${area.dv != null ? ` · СЛ ${area.dv}` : ''}</p><p>${status}</p>` +
    (area.weaponFailure ? `<p>Критический провал оружия плохого качества: ${esc(({jammed:'задержка',destroyed:'оружие сломано',destroyedBeyondRepair:'оружие не подлежит ремонту',coinToss:'определите эффект броском монеты'})[area.weaponFailure] ?? 'см. описание оружия')}</p>${area.weaponFailure === 'jammed' ? button('unjam','Устранить задержку · действие') : ''}` : '') +
    (area.phase === 'placement' ? button('place','Указать точку') : '') + (area.phase === 'smart' ? button('smart','Донаведение · 1d10 + 10') : '') + (area.phase === 'scatter' ? `<div class="aoe-gm">${button('scatter','Указать место взрыва')}</div>` : '') +
    `<ul>${roster}</ul>${damage}` + (area.phase === 'defenses' ? `<div>${button('recount','Обновить цели', '',Boolean(area.damage))}${button('damage',area.profile.mode === 'damage' || area.profile.mode === 'direct' ? `Общий урон · ${area.profile.formula}` : 'Подготовить эффект','',Boolean(area.damage))}<span class="aoe-gm">${button('apply','Применить ко всем','',!area.damage)}</span></div>` : '') +
    `<details><summary>Правила и укрытия</summary><p>${area.profile.perTargetDamage?'Для «Торнадо сюрикенов» урон бросается отдельно каждой цели.':'Урон бросается один раз.'} Броня и сопротивление считаются отдельно. Успешное уклонение исключает цель. ${area.profile.coverImmune?'Охранная граната не повреждает укрытие или щит; они блокируют попадание.':'При взрыве разрушенное укрытие пропускает полный урон, а не остаток.'} Стены Foundry не содержат ПЗ: мастер указывает их кнопкой «Укрытие». Для иммунитета или объекта вне опасности используйте «Исключить».</p><p>Дым: −4 только к действиям, которым мешает видимость. Специальные эффекты нестандартного боеприпаса требуют его отдельного правила.</p></details></section>`;
}
export async function selectPoint({sheet=null} = {}) {
  const restore=sheet?.rendered && !sheet._minimized;
  if(restore) await sheet.minimize();
  ui.notifications.info('Щёлкните по клетке на сцене. Esc — отмена.');
  try { return await new Promise(resolve => {
    const stage = canvas.stage, board = canvas.app.view;
    const finish = value => { board.removeEventListener('pointerdown', click, true); window.removeEventListener('keydown', key, true); Hooks.off('canvasTearDown',teardown); resolve(value); };
    const key = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); finish(null); } };
    const click = event => {
      if (event.button !== 0) return;
      // Capture the DOM event: tokens and templates can stop PIXI propagation.
      event.preventDefault(); event.stopImmediatePropagation();
      const rect = board.getBoundingClientRect(), screen = canvas.app.renderer.screen;
      const p = stage.worldTransform.applyInverse({x:(event.clientX-rect.left)*screen.width/rect.width,y:(event.clientY-rect.top)*screen.height/rect.height});
      const offset = canvas.grid.getOffset(p), centre = canvas.grid.getCenterPoint(offset);
      finish({ x: centre.x, y: centre.y });
    };
    const teardown=Hooks.once('canvasTearDown',()=>finish(null));
    board.addEventListener('pointerdown', click, true); window.addEventListener('keydown', key, true);
  }); } finally { if(restore && sheet.rendered) await sheet.maximize(); }
}
export function activateAreaCard(message, html) {
  const area = getArea(message), root = html?.[0] ?? html;
  if (!area || !root?.querySelectorAll) return;
  if (area.version !== 2) {
    root.querySelectorAll('[data-action^="cprAddendaArea"]').forEach(b => { b.disabled = true; b.title = 'Карточка старой версии: выполните новую атаку.'; }); return;
  }
  if (!game.user.isGM) root.querySelectorAll('.aoe-gm').forEach(e => e.hidden = true);
  for (const b of root.querySelectorAll('[data-aoe-action]')) {
    if (b.dataset.aoeBound) continue; b.dataset.aoeBound = 'true';
    b.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      const action = b.dataset.aoeAction, uuid = b.dataset.tokenUuid, key = `${message.id}:${action}:${uuid}`;
      if (busy.has(key)) return; busy.add(key); b.disabled = true;
      try {
        let data = { uuid };
        if(['dodge','save','smart'].includes(action)&&event.shiftKey) {
          const rollActor=action==='smart' ? await fromUuid(getArea(message).shooter) : (await fromUuid(uuid)).actor;
          const options=await Dialog.prompt({title:'Модификаторы броска',content:`<label>Потратить удачу<input name="luck" type="number" value="0" min="0" max="${Number(rollActor.system.stats.luck?.value??0)}"></label>${action==='smart'?'':'<label>Модификатор обстоятельств<input name="modifier" type="number" value="0"></label>'}`,callback:h=>({luck:Number(h.find('[name=luck]').val()),modifier:Number(h.find('[name=modifier]').val()??0)}),rejectClose:false});
          if(!options)return;Object.assign(data,options);
        }
        if (['place','scatter','dodgeMove'].includes(action)) { data.point = await selectPoint(); if (!data.point) return; }
        if (action === 'cover') {
          const row = getArea(message).targets.find(t => t.uuid === uuid);
          const value = await Dialog.prompt({ title: 'Укрытие цели', content: `<p>Текущие ПЗ предмета, полностью закрывающего цель. 0 — укрытия нет.</p><input name="hp" type="number" min="0" value="${row.coverHp ?? 0}"><label><input type="checkbox" name="shield" ${row.shield ? 'checked' : ''}>Использовать экипированный щит</label>`, callback: h => ({ hp: Number(h.find('[name=hp]').val()), shield: h.find('[name=shield]').prop('checked') }), rejectClose: false });
          if (!value) return; Object.assign(data, value);
        }
        if (action === 'emp') {
          const token = await fromUuid(uuid), candidates = empCandidates(token.actor);
          const ids = await Dialog.prompt({ title: 'ЭМИ — выбор мастера', content: '<p>До двух предметов; отключение на 1 минуту.</p>' + candidates.map(i => `<label style="display:block"><input type="checkbox" name="emp" value="${i.id}">${esc(i.name)}</label>`).join(''), callback: h => h.find('[name=emp]:checked').map((_, e) => e.value).get(), rejectClose: false });
          if (!ids) return; data.ids = ids;
        }
        await requestAction(message.id, action, data);
      } catch (error) { reportError(error); }
      finally { busy.delete(key); b.disabled = false; }
    });
  }
}
export async function throwGrenade(item, event = {}) {
  requireGM();
  if (!item.isOwner || item.type !== 'ammo' || item.system.variety !== 'grenade') throw new Error('Выберите свою ручную гранату.');
  if (busy.has(item.uuid)) return;
  busy.add(item.uuid);
  try {
    if (!(item.system.amount > 0)) throw new Error('Гранаты закончились.');
    const actor = item.actor, shooter = tokenOf(actor);
    if (!shooter) throw new Error('Выберите токен бросающего на сцене.');
    const point = await selectPoint({sheet:actor.sheet}); if (!point) return;
    const snapshot = snapshotAreaAttack(item);
    const distance = canvas.grid.measurePath([shooter.center, point]).distance / sceneScale(canvas.scene.grid).units;
    if (distance > 25) throw new Error('Ручную гранату можно бросить не дальше 25 м.');
    const skill = actor.itemTypes.skill.find(s => ['Athletics','Атлетика',game.i18n.localize('CPR.global.itemType.skill.athletics')].includes(s.name));
    if (!skill) throw new Error('У персонажа отсутствует навык «Атлетика».');
    const roll = skill.createRoll('skill', actor);
    if (!await roll.handleRollDialog(event, actor, skill)) return;
    // Consume once, after placement and confirmation; inventory stays for history.
    if (socket) await socket.executeAsUser('consumeGrenade', game.users.activeGM.id, item.uuid);
    else if (game.user.isGM) await item.update({ 'system.amount': item.system.amount - 1 });
    else throw new Error('Для броска игроком включите socketlib.');
    await roll.roll();
    if(roll.luck>0) await actor.update({'system.stats.luck.value':Math.max(0,actor.system.stats.luck.value-roll.luck)});
    return createAreaAttack({ item, actor, roll, snapshot, shooter, aimPoint: point });
  } finally { busy.delete(item.uuid); }
}

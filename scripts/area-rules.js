/** CPR core Explosives / Shotgun Shells / Throw; Data Pool weapons/ammunition.
 * Pure rules, shared by UI, the GM resolver and regression tests. */
import { getAttackRules, isShotAttack, isAttackItem } from './weapon-dv.js';
import { catalogueIdentity, CATALOGUE_FLAMETHROWERS } from './catalogue-rules.js';
export const ID = 'cpr-addenda';
export const BLAST = 'blast', SHOT = 'shot';
export const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
export function areaKindOf(item) {
  if (catalogueIdentity(item)==='Molotov Cocktail') return BLAST;
  if (item?.type === 'ammo') return item.system.variety === 'grenade' ? BLAST : null;
  if (!isAttackItem(item)) return null;
  if (isShotAttack(item)) return SHOT;
  let variety;
  try { variety = item._getLoadedAmmoProp?.('variety'); } catch { /* Empty weapon. */ }
  if (variety) return ['grenade', 'rocket'].includes(variety) ? BLAST : null;
  return ['grenadeLauncher', 'rocketLauncher'].includes(item.system.weaponType) ? BLAST : null;
}
export function ammoProfile(ammo, kind, base = '6d6') {
  const type = String(ammo.type ?? 'basic').toLowerCase().replace(/[\s-]/g, '');
  const blast = kind === BLAST;
  const profile = { type, formula: base, mode: 'damage', ablation: ammo.ablationValue ?? 1,
    lethal: true, critical: true, resistance: null, effect: null };
  if (['armorpiercing', 'smart'].includes(type) || (blast && type === 'basic')) profile.ablation = 2;
  if (type === 'incendiary') profile.effect = 'fire';
  if (type === 'rubber') Object.assign(profile, { ablation: 0, lethal: false, critical: false });
  const saves = { biotoxin: [15, 'resist', '3d6'], poison: [13, 'resist', '2d6'],
    emp: [15, 'cybertech', '0'], flashbang: [15, 'resist', '0'], sleep: [13, 'resist', '0'], teargas: [13, 'resist', '0'] };
  if (saves[type]) {
    const [dv, skill, formula] = saves[type];
    Object.assign(profile, { mode: formula === '0' ? 'effect' : 'direct', formula,
      resistance: { dv, skill }, ablation: 0, critical: false, effect: type });
  }
  if (type === 'smoke') Object.assign(profile, { mode: 'smoke', formula: '0', ablation: 0, critical: false, effect: 'smoke' });
  if (type === 'acid') Object.assign(profile, { mode: 'acid', formula: '0', ablation: 1, critical: false });
  if (!['basic', 'armorpiercing', 'smart', 'incendiary', 'rubber', 'expansive', 'acid', 'smoke', ...Object.keys(saves)].includes(type)) {
    Object.assign(profile, { mode: 'manual', formula: '0', critical: false });
  }
  return profile;
}
export function snapshotAreaAttack(item, fireMode = 'attack', kind = areaKindOf(item)) {
  const ammo = item.type === 'ammo' ? copy(item.system) : {};
  if (item.type !== 'ammo') for (const key of ['type', 'variety', 'ablationValue', 'overrides']) {
    try { ammo[key] = copy(item._getLoadedAmmoProp?.(key)); } catch { /* Empty weapon. */ }
  }
  if (catalogueIdentity(item)==='Molotov Cocktail') Object.assign(ammo,{type:'incendiary',variety:'grenade',ablationValue:1});
  let damageRoll;
  if (isAttackItem(item)) damageRoll = item.createRoll('damage', item.actor, { damageType: 'attack' });
  const profile = ammoProfile(ammo, kind, damageRoll?.formula ?? (kind === SHOT ? '3d6' : '6d6'));
  const ammunitionKey=catalogueIdentity(item.type==='ammo'?item:item.getInstalledItems?.('ammo')?.[0]);
  if (ammunitionKey==='Grenade (KTech Security)') Object.assign(profile,{formula:'5d6',ablation:2,coverImmune:true});
  if (ammunitionKey==='Grenade (Shuriken Tornado)') Object.assign(profile,{formula:'6d6',mode:'damage',ablation:2,critical:true,perTargetDamage:true,expansive:true});
  if (catalogueIdentity(item)==='Molotov Cocktail') Object.assign(profile,{formula:'5d6',effect:'fire',fireDamage:2});
  if (CATALOGUE_FLAMETHROWERS.includes(catalogueIdentity(item))) Object.assign(profile,
    { formula:'3d6', mode:'damage', ablation:1, effect:'fire', fireDamage:4, critical:false, resistance:null });
  if (catalogueIdentity(item)==='Aegis') Object.assign(profile,
    {formula:'4d6',mode:'damage',ablation:0,lethal:false,critical:false,effect:null,resistance:null});
  if (catalogueIdentity(item)==='Nomad Air Cannon') {
    profile.delivery='liquid';profile.acidAllArmor=true;
    if (!['acid','poison','biotoxin'].includes(profile.type)) Object.assign(profile,
      {formula:'0',mode:'effect',ablation:0,critical:false,effect:null,resistance:null});
  }
  return { kind, fireMode, ...getAttackRules(item, fireMode), ammo,
    profile: { ...profile, mods: copy(damageRoll?.mods ?? []),
      ignoreArmorPercent: damageRoll?.rollCardExtraArgs?.ignoreArmorPercent ?? 0,
      ignoreBelowSP: damageRoll?.rollCardExtraArgs?.ignoreBelowSP ?? 0 },
    dvTable: item.system.dvTable ?? '', weaponType: item.system.weaponType ?? 'thrownWeapon',
    thrown: item.type === 'ammo' || item.system.weaponType === 'thrownWeapon' };
}
export function sceneScale(grid) {
  const feet = /^(ft|feet|foot|фут[а-я]*)\.?$/i.test(String(grid.units ?? '').trim());
  const metres = Number(grid.distance) * (feet ? 0.3048 : 1);
  if (!(metres > 0) || !(grid.size > 0)) throw new Error('У сцены неверный масштаб сетки.');
  return { pixels: grid.size / metres, units: feet ? 1 / 0.3048 : 1 };
}
export function snapToGrid(degrees) {
  const degrees8 = ((Math.round(degrees / 45) * 45) % 360 + 360) % 360;
  return { degrees: degrees8, dx: Math.round(Math.cos(degrees8 * Math.PI / 180)), dy: Math.round(Math.sin(degrees8 * Math.PI / 180)) };
}
export function areaGeometry(kind, grid, origin, direction = 0) {
  const scale = sceneScale(grid), metres = kind === SHOT ? 6 : 10;
  const facing = snapToGrid(direction), side = metres * scale.pixels;
  const centre = kind === SHOT ? { x: origin.x + facing.dx * 4 * scale.pixels, y: origin.y + facing.dy * 4 * scale.pixels } : origin;
  const hit = { x: centre.x - side / 2, y: centre.y - side / 2, size: side };
  return { kind, facing: facing.degrees, metres, squares: metres / 2, hit,
    template: { t: 'rect', x: hit.x, y: hit.y, direction: 45, distance: metres * scale.units * Math.SQRT2, angle: 0 } };
}
export function inBlast(point, area) {
  return point.x >= area.x && point.x < area.x + area.size && point.y >= area.y && point.y < area.y + area.size;
}
export function intersects(token, hit) {
  const d = token.document ?? token;
  const size = d.parent?.grid?.size ?? 100;
  const w = token.w ?? d.width * size, h = token.h ?? d.height * size;
  if (Number.isFinite(w) && Number.isFinite(h)) return d.x < hit.x + hit.size && d.x + w > hit.x && d.y < hit.y + hit.size && d.y + h > hit.y;
  return token.center && inBlast(token.center, hit);
}
export function rangedDV(distance, { kind, thrown, weaponType }, rows = null) {
  if (!Number.isFinite(distance) || distance < 0) return null;
  if (kind === SHOT) return distance <= 6 ? 13 : null;
  if (thrown && distance > 25) return null;
  if (rows) {
    const entry = rows.find(r => distance <= Number(r.range[1]));
    const n = Number(entry?.text);
    return entry && Number.isFinite(n) && n > 0 ? n : null;
  }
  const bounds = [6, 12, 25, 50, 100, 200, 400, 800];
  const dvs = weaponType === 'rocketLauncher' ? [17,16,15,15,20,20,25,30] : [16,15,15,17,20,22,25,null];
  const i = bounds.findIndex(x => distance <= x);
  return i < 0 ? null : dvs[i];
}
export function coverOutcome(kind, damage, hp, coverImmune=false) {
  if (hp == null) return { unresolved: true };
  if (hp <= 0) return { blocked: false, remaining: 0 };
  if (coverImmune) return {blocked:true,remaining:hp};
  return { blocked: kind === SHOT || damage < hp, remaining: Math.max(0, hp - damage) };
}
export function effectiveTargets(area) {
  return (area.targets ?? []).filter(t => !t.excluded && t.defense !== 'dodged' && !t.applied);
}

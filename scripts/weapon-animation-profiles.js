import { catalogueIdentity, CATALOGUE_FLAMETHROWERS } from './catalogue-rules.js';
import { isAttackItem } from './weapon-dv.js';

// Database references only. JB2A media remain in the user's installed library.
export const WEAPON_EFFECTS = Object.freeze({
  bullet: 'jb2a.bullet.02.orange', arrow: 'jb2a.arrow.physical.white.01',
  bolt: 'jb2a.bolt.physical.white', blade: 'jb2a.sword.melee.01.white',
  knife: 'jb2a.dagger.melee.02.white', blunt: 'jb2a.maul.melee.standard.white',
  punch: 'jb2a.unarmed_strike.physical.01.orange', claws: 'jb2a.claws.200px.bright_orange',
  bite: 'jb2a.bite.200px.grey', shock: 'jb2a.static_electricity.01.blue',
  smoke: 'jb2a.smoke.puff.centered.dark_black', flash: 'jb2a.impact.005.white',
  explosion: 'jb2a.explosion.01.orange', flame: 'jb2a.fire_jet.orange', laser: 'jb2a.lasershot.blue',
});
// Same animation families in the free library, with its available colours.
export const FREE_WEAPON_EFFECTS = Object.freeze({
  bolt: 'jb2a.bolt.physical.orange', punch: 'jb2a.unarmed_strike.physical.01.blue',
  claws: 'jb2a.claws.200px.red', bite: 'jb2a.bite.200px.red',
  smoke: 'jb2a.smoke.puff.centered.grey', flash: 'jb2a.impact.005.orange',
});
export function resolveWeaponEffect(effect, entryExists) {
  return [WEAPON_EFFECTS[effect], FREE_WEAPON_EFFECTS[effect]].find(path => path && entryExists(path)) ?? null;
}
export function weaponAnimationProfile(item) {
  if (!isAttackItem(item) && !(item?.type === 'ammo' && item.system?.variety === 'grenade')) return null;
  const s = item.system ?? {}, key = catalogueIdentity(item),
    name = `${key} ${item.flags?.babele?.originalName ?? ''} ${item.name ?? ''}`.toLowerCase();
  // Names refine visual appearance only; combat rules never depend on these guesses.
  if (CATALOGUE_FLAMETHROWERS.includes(key) || /flamethrower|огнем[её]т/.test(name)) return { effect: 'flame', ranged: true };
  if (key === 'Molotov Cocktail' || item.type === 'ammo') return { effect: 'explosion', ranged: true };
  if (/vampyres|вампир/.test(name)) return { effect: 'bite', ranged: false, onTarget: true };
  if (/wolvers|rippers|scratchers|когти|росомах|кромсател/.test(name)) return { effect: 'claws', ranged: false, onTarget: true };
  if (/stun|taser|электрошок|шоков/.test(name)) return { effect: 'shock', ranged: Boolean(s.isRanged), onTarget: true };
  if (/laser|railgun|emg-86|лазер|рельсотрон/.test(name)) return { effect: 'laser', ranged: true };
  const type = s.weaponType;
  if (type === 'bow') return { effect: /crossbow|арбалет/.test(name) ? 'bolt' : 'arrow', ranged: true };
  if (['grenadeLauncher', 'rocketLauncher'].includes(type)) return { effect: 'explosion', ranged: true };
  if (['unarmed', 'martialArts'].includes(type)) return { effect: 'punch', ranged: false, onTarget: true };
  if (type === 'thrownWeapon') return { effect: 'knife', ranged: true };
  if (s.isRanged || ['medPistol','heavyPistol','vHeavyPistol','smg','heavySmg','assaultRifle','sniperRifle','shotgun'].includes(type)) return { effect: 'bullet', ranged: true };
  if (/baton|hammer|club|дубин|молот|дубинк|бита/.test(name)) return { effect: 'blunt', ranged: false };
  return { effect: type === 'lightMelee' ? 'knife' : 'blade', ranged: false };
}
export function areaAnimationEffect(area) {
  const p = area.profile ?? {};
  if (p.effect === 'fire') return area.kind === 'shot' ? 'flame' : 'explosion';
  if (p.type === 'emp') return 'shock';
  if (p.type === 'flashbang') return 'flash';
  if (['smoke','teargas','sleep','poison','biotoxin'].includes(p.type)) return 'smoke';
  if (p.delivery === 'liquid' || p.type === 'acid' || p.mode === 'manual') return 'flash';
  return area.kind === 'shot' ? 'bullet' : 'explosion';
}
export function isAnimatedWeaponRoll(roll) {
  return /(?:^|\/)cpr-(?:attack|aimed-attack|autofire|suppressive-fire)-rollcard\.hbs$/.test(roll?.rollCard ?? '');
}
export function animationRecipients(message) {
  const ids = (message?.whisper ?? []).map(u => typeof u === 'string' ? u : u.id);
  if (!ids.length) return null;
  if (!message.blind) ids.push(typeof message.user === 'string' ? message.user : message.user?.id);
  return [...new Set(ids.filter(Boolean))];
}

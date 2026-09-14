import { WEAPON_EFFECTS, weaponAnimationProfile, areaAnimationEffect, isAnimatedWeaponRoll, animationRecipients } from './weapon-animation-profiles.js';
const ID = 'cpr-addenda';
const played = new Set();
const enabled = () => game.settings.get(ID, 'weaponAnimations');
const report = error => console.error(`${ID} | JB2A`, error);
const disabledItem = item => item?.flags?.autoanimations?.killAnim || item?.flags?.autoanimations?.isEnabled === false;
function claim(id) {
  if (!id || played.has(id)) return false;
  played.add(id);
  if (played.size > 1000) played.delete(played.values().next().value);
  return true;
}
export function weaponAnimationStatus() {
  return { enabled: enabled(), sequencer: Boolean(game.modules.get('sequencer')?.active),
    libraries: ['jb2a_patreon', 'JB2A_DnD5e'].filter(id => game.modules.get(id)?.active),
    effects: Object.fromEntries(Object.entries(WEAPON_EFFECTS).map(([key, path]) => [key, Boolean(globalThis.Sequencer?.Database.entryExists(path))])) };
}
async function syncAACompatibility() {
  if (!game.user.isGM || !game.modules.get('autoanimations')?.active) return;
  // AA 5's CPR adapter calls the pre-v12 grid.measureDistance API before its
  // public workflow hook. Its visual miss prediction also ignores Addenda DV.
  const saved = game.settings.get(ID, 'weaponAnimationAAPrevious');
  if (enabled()) {
    if (!Object.hasOwn(saved, 'canMissTarget')) await game.settings.set(ID, 'weaponAnimationAAPrevious', {canMissTarget: game.settings.get('autoanimations', 'canMissTarget')});
    if (game.settings.get('autoanimations', 'canMissTarget')) await game.settings.set('autoanimations', 'canMissTarget', false);
  } else if (Object.hasOwn(saved, 'canMissTarget')) {
    if (!game.settings.get('autoanimations', 'canMissTarget')) await game.settings.set('autoanimations', 'canMissTarget', saved.canMissTarget);
    await game.settings.set(ID, 'weaponAnimationAAPrevious', {});
  }
}
export function registerWeaponAnimations() {
  game.settings.register(ID, 'weaponAnimationAAPrevious', {scope:'world', config:false, type:Object, default:{}});
  game.settings.register(ID, 'weaponAnimations', {
    name:'CPRADDENDA.settings.weaponAnimations.name', hint:'CPRADDENDA.settings.weaponAnimations.hint',
    scope:'world', config:true, type:Boolean, default:false,
    onChange: () => syncAACompatibility().catch(report),
  });
  Hooks.once('ready', () => syncAACompatibility().catch(report));
  Hooks.on('AutomatedAnimations-WorkflowStart', (data, animationData) => {
    if (!enabled() || !weaponAnimationProfile(data.item)) return;
    // CPR emits attack, damage and item cards. Only our post-roll dispatch may
    // animate this weapon; native AA's chat listener would otherwise double it.
    if (!data.addendaWeaponAnimation) { data.stopWorkflow = true; return; }
    if (animationData) return; // Preserve custom item effects and AA autorec entries.
    data.stopWorkflow = true;
    if (!disabledItem(data.item)) playDefault(data.addendaWeaponAnimation).catch(report);
  });
  Hooks.on('cprAddendaAreaResolved', (message, area) => { playAreaAnimation(message, area).catch(report); });
}
function available(effect) {
  const path = WEAPON_EFFECTS[effect];
  return path && globalThis.Sequencer?.Database.entryExists(path) ? path : null;
}
function section(sequence, effect, location, message) {
  const file = available(effect);
  if (!file) return null;
  const part = sequence.effect().file(file).atLocation(location);
  const users = animationRecipients(message);
  if (users) part.forUsers(users);
  return part;
}
export async function animateWeaponRoll(roll, message) {
  if (!enabled() || !message?.id || message.flags?.[ID]?.area || !isAnimatedWeaponRoll(roll)) return;
  const entity = roll.entityData ?? {};
  const tokenDoc = canvas.scene?.tokens.get(entity.token);
  const actor = tokenDoc?.actor ?? game.actors.get(entity.actor);
  const item = actor?.items.get(entity.item);
  if (!weaponAnimationProfile(item) || disabledItem(item) || !claim(message.id)) return;
  const source = tokenDoc?.object ?? canvas.tokens?.controlled.find(t => t.actor?.id === actor?.id)
    ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor?.id);
  if (!source) { ui.notifications.info('Анимация оружия: поставьте токен атакующего на сцену.'); return; }
  const targets = [...game.user.targets].filter(t => t.scene?.id === canvas.scene.id || t.document?.parent?.id === canvas.scene.id);
  const mode = /autofire|suppressive-fire/.test(roll.rollCard) ? 'burst' : 'single';
  const context = {source, item, targets, message, mode};
  // AA 5 does not propagate chat whisper recipients to its effects.
  if (!animationRecipients(message) && game.modules.get('autoanimations')?.active && globalThis.AutomatedAnimations) {
    await AutomatedAnimations.playAnimation(source, item, {
      targets, workflow: message, addendaWeaponAnimation: context, overrideRepeat: mode === 'burst' ? 5 : 1,
    });
  } else await playDefault(context);
}
async function playDefault({source, item, targets, message, mode}) {
  if (!globalThis.Sequence || !game.modules.get('sequencer')?.active) return;
  const profile = weaponAnimationProfile(item);
  if (!profile) return;
  const sequence = new Sequence();
  // Without a selected target, a short directional attack still shows the shot.
  const angle = (Number(source.document.rotation) || 0) * Math.PI / 180;
  const destinations = targets.length ? targets : [{x: source.center.x + Math.cos(angle) * canvas.grid.size * 2,
    y: source.center.y + Math.sin(angle) * canvas.grid.size * 2}];
  for (const target of destinations) {
    const effect = section(sequence, profile.effect, profile.onTarget ? target : source, message);
    if (!effect) continue;
    if (profile.onTarget) effect.size(canvas.grid.size * 1.5);
    else if (profile.effect === 'explosion') effect.atLocation(target).size(canvas.grid.size * 2);
    else effect.stretchTo(target);
    if (mode === 'burst' && profile.ranged) effect.repeats(5, 90);
  }
  await sequence.play();
}
export async function playAreaAnimation(message, area) {
  if (!enabled() || !globalThis.Sequence || !game.modules.get('sequencer')?.active || area.scene !== canvas.scene?.uuid || !claim(`area:${message.id}`)) return;
  const item = await fromUuid(area.weapon);
  if (disabledItem(item)) return;
  const sequence = new Sequence(), kind = areaAnimationEffect(area), hit = area.geometry?.hit;
  if (!hit) return;
  if (area.kind === 'shot') {
    const centre = {x: hit.x + hit.size / 2, y: hit.y + hit.size / 2};
    if (kind === 'bullet') {
      const angle = area.geometry.facing * Math.PI / 180;
      for (const spread of [-0.3, 0, 0.3]) {
        const target = {x: centre.x - Math.sin(angle) * hit.size * spread, y: centre.y + Math.cos(angle) * hit.size * spread};
        section(sequence, 'bullet', area.origin, message)?.stretchTo(target);
      }
    } else section(sequence, kind, area.origin, message)?.stretchTo(centre);
  } else {
    // One effect at the final blast point, never one explosion per victim.
    if (!area.thrown && area.weaponType === 'rocketLauncher') {
      section(sequence, 'bullet', area.origin, message)?.stretchTo(area.blastCentre).waitUntilFinished(-100);
    }
    section(sequence, kind, area.blastCentre, message)?.size(hit.size);
  }
  await sequence.play();
}

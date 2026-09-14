import CPRMod from '/systems/cyberpunk-red-core/modules/rolls/cpr-modifiers.js';
import { catalogueIdentity, cataloguePreventsConcealment, filterCatalogueModifiers, filterCatalogueUpgrades, catalogueArmorPenalty, catalogueHandFit, catalogueVehicleFit, catalogueFrameConnected, CATALOGUE_SCOPED_GUNS } from './catalogue-rules.js';
let context;
function inContext(value, callback) {
  const saved = context;
  context = value;
  try { return callback(); } finally { context = saved; }
}
export function attackContext(weapon, actor, type) {
  const targets = [...(game.user?.targets ?? [])];
  const tokens = actor?.getActiveTokens?.() ?? [];
  const token = actor?.token?.object ?? tokens.find(t => t.controlled) ?? (tokens.length === 1 ? tokens[0] : null);
  let distance = null;
  if (token && targets.length === 1 && canvas?.scene) {
    const target = targets[0];
    const units = String(canvas.scene.grid.units ?? '').trim().toLowerCase();
    const scales = { m: 1, 'м': 1, meters: 1, metres: 1, 'метры': 1, 'метров': 1, ft: .3048, feet: .3048, 'футы': .3048, yd: .9144, yards: .9144 };
    if (Object.hasOwn(scales, units)) {
      distance = canvas.grid.measurePath([token.center, target.center]).distance * scales[units];
    }
  }
  const scope = CATALOGUE_SCOPED_GUNS.includes(catalogueIdentity(weapon)) ||
    (weapon.system.installedUpgrades ?? []).some(i => catalogueIdentity(i) === 'Sniping Scope' &&
    Number(i.system.modifiers?.attackmod?.value) === 1 && !(i.flags?.['cpr-addenda']?.empUntil > game.time.worldTime));
  return { weapon, actor, type, distance, scope };
}
export function applyCatalogueItemRules(item) {
  if (item.areEffectsSuppressed) {
    const original=item.areEffectsSuppressed;
    item.areEffectsSuppressed=function(...args) {
      return original.apply(this,args) || !catalogueFrameConnected(this,this.actor,game.time.worldTime);
    };
  }
  if (item.canInstallItems) {
    const original=item.canInstallItems;
    item.canInstallItems=function(items,...args) {
      const reason=catalogueHandFit(this,items) ?? catalogueVehicleFit(this,items);
      if(reason) { ui.notifications.warn(reason);return false; }
      return original.call(this,items,...args);
    };
  }
  if (item.getInstallableItems) {
    const original=item.getInstallableItems;
    item.getInstallableItems=function(...args) { return original.apply(this,args).filter(i=>!catalogueHandFit(this,[i]) && !catalogueVehicleFit(this,[i])); };
  }
  if (item.type === 'weapon' && cataloguePreventsConcealment(item)) {
    item.system.concealable.concealable = false;
    item.system.concealable.isConcealed = false;
  }
  if (item._createAttackRoll) {
    const original = item._createAttackRoll;
    item._createAttackRoll = function (type, actor, ...args) {
      return inContext(attackContext(this, actor, type), () => original.call(this, type, actor, ...args));
    };
  }
  if (item.getAllUpgradeMods) {
    const original = item.getAllUpgradeMods;
    item.getAllUpgradeMods = function (point, ...args) {
      const mods = original.call(this, point, ...args);
      return point === 'attackmod' ? filterCatalogueUpgrades(mods, this, { now: game.time.worldTime, context }) : mods;
    };
  }
}
// Called by the shared CPRMod wrapper in skill-role-compat. libWrapper permits
// only one registration per module on the same method, even through aliases.
export function applyCatalogueModifiers(result, effects, disabled = false) {
  if (disabled) return result;
  const actor = context?.actor ?? effects.find(e => e.parent?.actor)?.parent.actor;
  return filterCatalogueModifiers(result, effects, { actor, now: game.time.worldTime, context });
}
export function registerCatalogueRules() {
  libWrapper.register('cpr-addenda','CONFIG.Actor.documentClass.prototype.getArmorPenaltyMods',function(wrapped,stat) {
    return catalogueArmorPenalty(this,stat,wrapped(stat));
  },'WRAPPER');
  globalThis.cprAddendaCatalogueCore = { CPRMod };
  libWrapper.register('cpr-addenda', 'cprAddendaCatalogueCore.CPRMod.getSituationalRollMods', function (wrapped, roll, effects, item, actor) {
    if (!item?.system?.isWeapon && item?.type !== 'weapon') return wrapped(roll, effects, item, actor);
    const card = String(roll.rollCard ?? '');
    const type = card.includes('autofire') ? 'autofire' : card.includes('suppressive') ? 'suppressive' : card.includes('aimed') ? 'aimed' : 'attack';
    const result = inContext(attackContext(item, actor, type), () => wrapped(roll, effects, item, actor));
    // Core lists singleShot and aimedShot together for aimed attacks. They are
    // two representations of the same TeleOptics bonus, not two +1 bonuses.
    return result.filter(mod => !(type === 'aimed' && mod.key === 'bonuses.singleShot' && mod.source?.endsWith('(от 51 м)')));
  }, 'WRAPPER');
}

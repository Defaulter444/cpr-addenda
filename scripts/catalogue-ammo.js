import { catalogueIdentity } from './catalogue-rules.js';

export function junkDamageFormula(base, armored) {
  if (!armored) return base;
  return String(base).replace(/^(\d+)d6\b/, (_, dice) => `${Math.max(1, Number(dice)-1)}d6`);
}

/** Choose armor at the actual hit location after the damage dialog has closed.
 * Do not infer body armor from a helmet or use pre-ablation SP. */
export async function resolveCatalogueJunkRoll(roll, targets, {ask, calculateSP} = {}) {
  if (roll.isAutofire) { roll.formula='2d6';roll._addendaJunkResolved=true;return true; }
  if (!calculateSP) ({default:{calculateArmorSP:calculateSP}} = await import('/systems/cyberpunk-red-core/modules/utils/ActorUtils.js'));
  const location=roll.location==='head'?'head':'body';
  const states=[];
  for (const target of targets) {
    const actor=target.actor??target;
    if (!actor?.getEquippedArmors) continue;
    const armors=actor.getEquippedArmors(location);
    const sp=Math.max(0,...await Promise.all(armors.map(i=>calculateSP(i,location,true))));
    states.push(sp>=1);
  }
  let armored=states.length===targets.length && states.length && new Set(states).size===1 ? states[0] : undefined;
  if (armored===undefined && ask) armored=await ask();
  if (typeof armored!=='boolean') return false;
  roll.formula=junkDamageFormula(roll._addendaJunkBase,armored);
  roll._addendaJunkResolved=true;
  roll.rollTitle+=armored?' — кустарные, ОС цели ≥ 1':' — кустарные, без брони';
  return true;
}

export function applyCatalogueJunkRoll(roll, weapon, base=weapon.system.damage) {
  const ammo=weapon.getInstalledItems?.('ammo')?.[0];
  if (!catalogueIdentity(ammo).endsWith(' (Junk)')) return;
  // Preserve custom ammunition overrides; this correction is for the published
  // -1d6/minimum 1d6 profile only.
  const override=ammo.system.overrides?.damage;
  if (override?.mode!=='modify' || override.value!=='-1d6' || override.minimum!=='1d6') return;
  roll._addendaJunkBase=base;
  if (!roll.isAutofire) roll.formula=base;
  const dialog=roll.handleRollDialog;
  roll.handleRollDialog=async function(...args) {
    if (!await dialog.apply(this,args)) return false;
    return resolveCatalogueJunkRoll(this,[...(game.user?.targets??[])],{ask:()=>Dialog.wait({
      title:'Кустарные боеприпасы: броня цели',
      content:'<p>Укажите защиту в месте попадания. При разных значениях брони у нескольких целей бросайте урон отдельно для каждой группы.</p>',
      buttons:{armored:{label:'ОС от 1',callback:()=>true},bare:{label:'ОС 0',callback:()=>false},cancel:{label:'Отмена',callback:()=>null}},
      close:()=>null
    })});
  };
  const evaluate=roll.roll;
  roll.roll=async function(...args) {
    // Macros which bypass the dialog still get the correct targeted armor rule.
    if (!this._addendaJunkResolved && !await resolveCatalogueJunkRoll(this,[...(game.user?.targets??[])])) {
      throw new Error('Кустарные боеприпасы: выберите цель или подтвердите её броню в диалоге урона.');
    }
    return evaluate.apply(this,args);
  };
}

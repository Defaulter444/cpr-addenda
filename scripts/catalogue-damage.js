import { catalogueIdentity, catalogueLiveItems } from './catalogue-rules.js';

export function hasCatalogueCyberskull(actor, now = 0) {
  return [...catalogueLiveItems(actor, now).values()].some(i => catalogueIdentity(i) === 'Киберчереп');
}

/** Cyberskull removes the weak-point multiplier, not the head's armor,
 * critical bonus, shields or damage reduction. Keep each of those independent. */
export function cyberskullDamage(damage, bonus, sp, reduction, hp, lethal) {
  const raw = Math.max(0, damage - sp), total = raw + bonus;
  const taken = Math.max(0, total - reduction);
  return { raw, total, taken: lethal ? taken : Math.min(taken, Math.max(0, hp - 1)) };
}

export async function applyCyberskullDamage(actor, args, actorUtils, chat) {
  const [damage, bonusDamage, location, ablation, ammoVariety, ignoreArmorPercent,
    ignoreBelowSP, damageLethal, formData = {}] = args;
  let totalDamageReduction = 0;
  if (formData.damageReductionRole) for (const role of actor.itemTypes.role) {
    if (role.system.universalBonuses.includes('damageReduction')) totalDamageReduction += Math.floor(role.system.rank / role.system.bonusRatio);
    for (const ability of role.system.abilities.filter(a => a.universalBonuses.includes('damageReduction'))) totalDamageReduction += Math.floor(ability.rank / ability.bonusRatio);
  }
  if (formData.damageReductionAE) totalDamageReduction += actor.bonuses.universalDamageReduction;
  const armors = actor.getEquippedArmors('head');
  const originalSP = Math.max(0, ...await Promise.all(armors.map(a => actorUtils.calculateArmorSP(a, 'head', true))));
  const ignoreArmorEntirely = originalSP < ignoreBelowSP;
  const sp = ignoreArmorEntirely ? 0 : Math.round(originalSP * (1 - ignoreArmorPercent / 100));
  const armorData = { value: sp, equipped: armors.length > 0 };
  let shieldAblation = 0;
  const shield = [...actor.getEquippedArmors('shield')].sort((a,b) => b.system.shieldHitPoints.value - a.system.shieldHitPoints.value)[0];
  if (formData.useShield && shield?.system.shieldHitPoints.value > 0) {
    shieldAblation = Math.min(damage + bonusDamage, shield.system.shieldHitPoints.value);
    await actor._ablateArmor('shield', shieldAblation);
    if (!['grenade','rocket'].includes(ammoVariety) || shield.system.shieldHitPoints.value > 0) {
      return chat.RenderDamageApplicationCard({actor,damage,bonusDamage,hpReduction:0,totalDamageDealt:0,
        location,armorData,ablation:0,shieldAblation});
    }
  }
  const hp = actor.system.derivedStats.hp.value;
  const result = cyberskullDamage(damage, bonusDamage, sp, totalDamageReduction, hp, damageLethal);
  await actor.update({'system.derivedStats.hp.value': hp - result.taken});
  const lostSP = damage > sp && armors.length > 0 ? ablation : 0;
  if (lostSP) await actor._ablateArmor('head', lostSP);
  return chat.RenderDamageApplicationCard({actor,damage,bonusDamage,location,armorData,
    hpReduction:result.taken,rawDamageDealt:result.raw,totalDamageDealt:result.total,
    totalDamageReduction,ignoreArmorPercent,ignoreArmorEntirely,ignoreBelowSP,
    ablation:lostSP,shieldAblation,damageLethal});
}

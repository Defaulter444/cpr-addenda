import { ID, areaKindOf } from './area-rules.js';
import { createAreaAttack, tokenOf, registerAreaWorkflow } from './area-workflow.js';
import { registerCatalogueWeaponCards, renderCatalogueWeaponCard } from './catalogue-weapons.js';
export function isAttackRoll(roll) {
  return /cpr-(?:attack|aimed-attack|autofire)-rollcard/.test(roll?.rollCard ?? '');
}
export async function registerAreaAttacks() {
  registerAreaWorkflow();
  const { default: CPRChat } = await import('/systems/cyberpunk-red-core/modules/chat/cpr-chat.js');
  globalThis.cprAddendaChatClass = CPRChat;
  registerCatalogueWeaponCards(CPRChat);
  libWrapper.register(ID, 'cprAddendaChatClass.RenderRollCard', async function (wrapped, roll, ...rest) {
    if (roll._addendaNonlethal) return renderCatalogueWeaponCard(wrapped, roll, ...rest);
    if (!game.settings.get(ID, 'explosiveTemplates') || !isAttackRoll(roll)) return wrapped(roll, ...rest);
    const entity = roll.entityData;
    const token = canvas.scene?.tokens.get(entity?.token);
    const actor = token?.actor ?? game.actors.get(entity?.actor);
    const item = actor?.items.get(entity?.item);
    if (!item || (!roll._addendaArea && !areaKindOf(item))) return wrapped(roll, ...rest);
    if (/aimed-attack/.test(roll.rollCard)) { ui.notifications.warn('Площадная атака не может быть прицельной.'); return null; }
    return createAreaAttack({ item, actor, roll, snapshot: roll._addendaArea,
      shooter: tokenOf(actor, token?.id), aimPoint: roll._addendaAim });
  }, 'MIXED');
}

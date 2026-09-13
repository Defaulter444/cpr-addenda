import { ID, areaKindOf, SHOT, snapshotAreaAttack } from './area-rules.js';
import { hasShotgunAutoControl, isShotAttack, setWeaponDvTable } from './weapon-dv.js';
import { empDisabled, installedCyberware } from './area-effects.js';
import { selectPoint, validateAreaAim } from './area-workflow.js';
/** Called after the core installs the item's instance mixins. */
export function applyAreaItemRules(item) {
  if (item._createAttackRoll) {
    const attack = item._createAttackRoll;
    item._createAttackRoll = function (type, actor, ...rest) {
      if (empDisabled(this)) { ui.notifications.warn('Предмет отключён ЭМИ.'); return null; }
      if (this.getFlag('cpr-addenda', 'areaJammed')) { ui.notifications.warn('Сначала устраните задержку оружия (действие).'); return null; }
      if (!game.settings.get(ID, 'explosiveTemplates')) return attack.call(this, type, actor, ...rest);
      const kind = areaKindOf(this);
      if (kind && this._getLoadedAmmoProp?.('type') === 'smart' && !installedCyberware(actor).some(i => !empDisabled(i) && /^(Targeting Scope|Прицельный модуль|Тактический прицел)$/i.test(i.getFlag('babele','originalName') ?? i.name))) {
        ui.notifications.warn('Умной ракете нужен установленный прицельный модуль (Targeting Scope).'); return null;
      }
      if (kind && type === 'aimed') { ui.notifications.warn('Площадная атака не может быть прицельной.'); return null; }
      if (kind === SHOT && type === 'autofire' && !hasShotgunAutoControl(this)) { ui.notifications.warn('Для автоматической дроби нужен соответствующий узел управления огнём.'); return null; }
      const modes = this.system.fireModes, previous = modes?.suppressiveFire;
      if (kind === SHOT && type === 'autofire') modes.suppressiveFire = true;
      let roll;
      try { roll = attack.call(this, type, actor, ...rest); }
      finally { if (modes) modes.suppressiveFire = previous; }
      if (kind && type !== 'suppressive' && roll) {
        roll._addendaArea = snapshotAreaAttack(this, type, kind);
        const target = [...(game.user.targets ?? [])][0];
        roll._addendaAim = target ? { x: target.center.x, y: target.center.y } : null;
        const dialog = roll.handleRollDialog;
        roll.handleRollDialog = async function (...args) {
          if (!game.users.activeGM) { ui.notifications.warn('Для площадной атаки нужен подключённый мастер.'); return false; }
          if (!this._addendaAim) {
            this._addendaAim = await selectPoint({sheet:actor.sheet});
            if (!this._addendaAim) return false;
          }
          try { await validateAreaAim(this._addendaArea, actor, this._addendaAim); }
          catch (error) { ui.notifications.warn(error.message); return false; }
          return dialog.apply(this, args);
        };
      }
      return roll;
    };
  }
  if (item._createDamageRoll) {
    const damage = item._createDamageRoll;
    item._createDamageRoll = function (type, actor, ...rest) {
      if (!game.settings.get(ID, 'explosiveTemplates') || !isShotAttack(this)) return damage.call(this, type, actor, ...rest);
      const base = this.system.damage;
      this.system.damage = '3d6';
      try { return damage.call(this, 'attack', actor, ...rest); }
      finally { this.system.damage = base; }
    };
  }
  if (item.bulletConsumption) {
    const consume = item.bulletConsumption;
    item.bulletConsumption = function (roll) {
      if (game.settings.get(ID, 'explosiveTemplates') && isShotAttack(this) && hasShotgunAutoControl(this) && /cpr-autofire-rollcard/.test(roll?.rollCard ?? '')) return 4;
      return consume.call(this, roll);
    };
  }
  if (item._setDvTable) {
    const set = item._setDvTable;
    item._setDvTable = function (actor, table) {
      if (game.settings.get(ID, 'explosiveTemplates') && isShotAttack(this)) return setWeaponDvTable(this, actor, table);
      return set.call(this, actor, table);
    };
  }
}

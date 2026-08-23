/**
 * Ограничение установки модификаций по типам оружия.
 *
 * Зачем это нужно. Система Cyberpunk RED при установке модификации проверяет
 * только одно: совпадает ли `itemUpgrade.system.type` с типом предмета-носителя
 * (см. `cpr-container.js`, `canInstallItems`). То есть любая «оружейная»
 * модификация встаёт в любое оружие — глушитель в дробовик, барабанный магазин
 * снайперки в пистолет. Именно поэтому в корбуке девять отдельных
 * «Расширенных магазинов» вместо одного.
 *
 * Модуль добавляет второй уровень проверки, основанный на флагах предмета.
 * Предмет без флагов ведёт себя ровно так, как раньше.
 */

import { MODULE_ID, FLAGS, SETTINGS, getFlag, localize } from "./constants.js";
import { weaponTypeLabel } from "./cpr-config.js";

/**
 * Можно ли поставить эту модификацию в этот предмет.
 *
 * Чистая функция — не трогает документы, только читает. Вынесена отдельно,
 * чтобы её могли звать и проверка установки, и фильтр списка в диалоге.
 *
 * @param {Item} upgrade - устанавливаемая модификация
 * @param {Item|Actor} container - предмет (или актёр), куда её ставят
 * @returns {{allowed: Boolean, reason: String|null}}
 */
export function checkUpgradeFit(upgrade, container) {
  const pass = { allowed: true, reason: null };

  // Ограничения касаются только модификаций, вставляемых в предметы.
  if (upgrade?.type !== "itemUpgrade") return pass;
  if (container?.documentName !== "Item") return pass;

  const allowedTypes = getFlag(upgrade, FLAGS.allowedWeaponTypes);
  const deniedTypes = getFlag(upgrade, FLAGS.deniedWeaponTypes);

  // Нет разметки — нет ограничения. Так модуль не вмешивается в чужой контент.
  const hasAllowList = Array.isArray(allowedTypes) && allowedTypes.length > 0;
  const hasDenyList = Array.isArray(deniedTypes) && deniedTypes.length > 0;
  if (!hasAllowList && !hasDenyList) return pass;

  // Разметка по типам оружия имеет смысл только для оружия. Если модификация
  // размечена, но её ставят, скажем, в броню — это уже отсеет сама система.
  if (container.type !== "weapon") return pass;

  const weaponType = container.system?.weaponType ?? "";
  const typeLabel = weaponTypeLabel(weaponType);

  if (hasDenyList && deniedTypes.includes(weaponType)) {
    return {
      allowed: false,
      reason: localize("notify.deniedWeaponType", {
        upgrade: upgrade.name,
        weapon: container.name,
        type: typeLabel,
      }),
    };
  }

  if (hasAllowList && !allowedTypes.includes(weaponType)) {
    const allowedLabels = allowedTypes.map(weaponTypeLabel).join(", ");
    return {
      allowed: false,
      reason: localize("notify.wrongWeaponType", {
        upgrade: upgrade.name,
        weapon: container.name,
        type: typeLabel,
        allowed: allowedLabels,
      }),
    };
  }

  return pass;
}

/**
 * Проверяет весь список устанавливаемых предметов и сообщает о первой помехе.
 *
 * @param {Item} container - предмет, куда ставят
 * @param {Array<Item>} itemList - что ставят
 * @returns {Boolean} - можно ли ставить всё из списка
 */
function checkList(container, itemList) {
  if (!Array.isArray(itemList)) return true;
  let allowed = true;
  for (const item of itemList) {
    const verdict = checkUpgradeFit(item, container);
    if (!verdict.allowed) {
      ui.notifications.error(verdict.reason);
      allowed = false;
    }
  }
  return allowed;
}

/**
 * Навешивает наши проверки поверх системных на один конкретный предмет.
 *
 * Тонкость: `canInstallItems` и `getInstallableItems` — не методы прототипа, а
 * функции, которые система вешает на каждый экземпляр предмета в `loadMixins()`
 * (он вызывается из `prepareDerivedData`). Обернуть их напрямую через libWrapper
 * нельзя, поэтому вызов идёт из обёртки над `loadMixins` — сразу после того, как
 * система назначила оригиналы. Переприсваивание безопасно: система каждый раз
 * ставит свежие функции, так что обёртки не накапливаются.
 *
 * @param {Item} item - предмет, которому только что загрузили миксины
 */
export function applyInstallRestrictions(item) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enforceWeaponTypes)) return;

  // Дополнительная проверка при самой установке.
  if (typeof item.canInstallItems === "function") {
    const systemCanInstall = item.canInstallItems;
    item.canInstallItems = (itemList) => {
      if (!systemCanInstall.call(item, itemList)) return false;
      return checkList(item, itemList);
    };
  }

  // Отсев неподходящего ещё на этапе списка в диалоге установки,
  // чтобы игрок не выбирал то, что всё равно не встанет.
  if (typeof item.getInstallableItems === "function") {
    const systemGetInstallable = item.getInstallableItems;
    item.getInstallableItems = (type = false) => {
      const list = systemGetInstallable.call(item, type);
      if (!Array.isArray(list)) return list;
      return list.filter((i) => checkUpgradeFit(i, item).allowed);
    };
  }
}

/**
 * Единая точка вмешательства в жизненный цикл предметов.
 *
 * Система назначает функции миксинов на каждый экземпляр предмета внутри
 * `loadMixins()`, а не держит их в прототипе. Значит, обернуть можно только сам
 * `loadMixins` — и сделать это ровно один раз, чтобы не плодить конкурирующие
 * обёртки на одну функцию. Все наши правки предмета вызываются отсюда.
 */

import { MODULE_ID } from "./constants.js";
import { applyInstallRestrictions } from "./install-restrictions.js";
import { applyInstalledUsage } from "./effect-usage.js";
import { applyCarrierPatches } from "./carrier-changes.js";

export function registerItemPatches() {
  libWrapper.register(
    MODULE_ID,
    "CONFIG.Item.documentClass.prototype.loadMixins",
    function cprAddendaLoadMixins(wrapped, ...args) {
      const result = wrapped(...args);

      // Каждая правка сама решает, применяться ли ей: смотрит на свою
      // настройку и на тип предмета. Ошибка в одной не должна ронять
      // подготовку данных предмета целиком — иначе лист просто не откроется.
      try {
        applyInstallRestrictions(this);
      } catch (err) {
        console.error(
          `${MODULE_ID} | Сбой в ограничениях установки для «${this?.name}»`,
          err
        );
      }

      try {
        applyInstalledUsage(this);
      } catch (err) {
        console.error(
          `${MODULE_ID} | Сбой в режимах эффектов для «${this?.name}»`,
          err
        );
      }

      try {
        applyCarrierPatches(this);
      } catch (err) {
        console.error(
          `${MODULE_ID} | Сбой в правках носителя для «${this?.name}»`,
          err
        );
      }

      return result;
    },
    "WRAPPER"
  );
}

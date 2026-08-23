/**
 * Модификация меняет поля предмета, в который установлена.
 *
 * Активный эффект на это не способен: эффект умеет менять только своего
 * носителя или актёра, но не соседний предмет. Система обходит это узким
 * набором модификаторов — урон, точность, магазин, — и всё, что за его
 * пределами, остаётся текстом в описании: режимы огня, список боеприпасов,
 * таблица дальности, тип оружия.
 *
 * Здесь другой путь. При установке модификации модуль запоминает исходные
 * значения нужных полей носителя и записывает новые прямо в предмет. При
 * снятии — возвращает как было. Это не эффект, а управляемая правка, и именно
 * поэтому она умеет всё, чего не умеют эффекты.
 *
 * Что менять, описывает сама модификация во флаге `carrierChanges`:
 *
 *   "carrierChanges": {
 *     "system.fireModes.autoFire":  { "op": "set", "value": 3 },
 *     "system.ammoVariety":         { "op": "add", "value": ["heavyPistol"] },
 *     "system.installedItems.slots":{ "op": "inc", "value": 1 }
 *   }
 *
 * Три операции: `set` — записать значение, `inc` — прибавить к числу,
 * `add` — дополнить список без повторов.
 *
 * Откат хранится на носителе, в разрезе по модификации. Если на стволе стоят
 * две модификации, правящие одно поле, снятие любой из них вернёт то значение,
 * которое было до неё, — поэтому порядок снятия важен, и модуль предупреждает
 * о таком наложении при установке.
 */

import { MODULE_ID, localize } from "./constants.js";

/** Флаг на модификации: что она меняет у носителя. */
export const CHANGES_FLAG = "carrierChanges";

/** Флаг на носителе: что и кем было изменено, чтобы вернуть обратно. */
const RESTORE_FLAG = "carrierRestore";

const OPERATIONS = ["set", "inc", "add"];

/**
 * Достаёт значение по пути вида "system.fireModes.autoFire".
 *
 * @param {Object} root - объект, откуда читаем
 * @param {String} path - путь через точку
 * @returns {*}
 */
function readPath(root, path) {
  return path.split(".").reduce((node, key) => node?.[key], root);
}

/**
 * Вычисляет новое значение поля по описанию операции.
 *
 * @param {*} current - текущее значение поля у носителя
 * @param {{op: String, value: *}} change - описание правки
 * @returns {*} - что записать
 */
function applyOperation(current, change) {
  switch (change.op) {
    case "inc":
      return (Number(current) || 0) + Number(change.value);
    case "add": {
      const list = Array.isArray(current) ? current : [];
      const added = Array.isArray(change.value) ? change.value : [change.value];
      return Array.from(new Set([...list, ...added]));
    }
    case "set":
    default:
      return change.value;
  }
}

/**
 * Читает описание правок с модификации, отсеивая некорректные.
 *
 * @param {Item} upgrade - модификация
 * @returns {Object} - карта «путь -> операция»
 */
export function getCarrierChanges(upgrade) {
  const raw = upgrade?.getFlag?.(MODULE_ID, CHANGES_FLAG);
  if (!raw || typeof raw !== "object") return {};

  const changes = {};
  for (const [path, change] of Object.entries(raw)) {
    if (!change || typeof change !== "object") continue;
    if (!OPERATIONS.includes(change.op)) {
      console.warn(
        `${MODULE_ID} | «${upgrade.name}»: неизвестная операция "${change.op}" для поля ${path}`
      );
      continue;
    }
    if (!path.startsWith("system.")) {
      console.warn(
        `${MODULE_ID} | «${upgrade.name}»: правка вне system игнорируется — ${path}`
      );
      continue;
    }
    changes[path] = change;
  }
  return changes;
}

/**
 * Применяет правки модификации к носителю и запоминает, как было.
 *
 * @async
 * @param {Item} carrier - предмет, в который установили модификацию
 * @param {Item} upgrade - установленная модификация
 */
export async function applyCarrierChanges(carrier, upgrade) {
  const changes = getCarrierChanges(upgrade);
  if (!Object.keys(changes).length) return;

  const restore = foundry.utils.duplicate(
    carrier.getFlag(MODULE_ID, RESTORE_FLAG) ?? {}
  );
  // Повторное применение той же модификации затёрло бы сохранённый оригинал
  // текущим (уже изменённым) значением — и вернуть исходное стало бы нечем.
  if (restore[upgrade.id]) return;

  const updates = {};
  const previous = {};

  for (const [path, change] of Object.entries(changes)) {
    const current = readPath(carrier, path);
    previous[path] = current ?? null;
    updates[path] = applyOperation(current, change);
  }

  restore[upgrade.id] = previous;
  updates[`flags.${MODULE_ID}.${RESTORE_FLAG}`] = restore;

  await carrier.update(updates);

  // Предупреждаем о наложении: если ту же строчку уже правит другая
  // установленная модификация, порядок снятия начнёт иметь значение.
  const overlapping = Object.keys(restore)
    .filter((id) => id !== upgrade.id)
    .filter((id) =>
      Object.keys(restore[id] ?? {}).some((path) => path in changes)
    );
  if (overlapping.length) {
    ui.notifications.warn(
      localize("carrier.overlap", { item: carrier.name, upgrade: upgrade.name })
    );
  }
}

/**
 * Возвращает полям носителя исходные значения.
 *
 * @async
 * @param {Item} carrier - предмет, из которого сняли модификацию
 * @param {Item|String} upgrade - снятая модификация или её id
 */
export async function revertCarrierChanges(carrier, upgrade) {
  const upgradeId = typeof upgrade === "string" ? upgrade : upgrade?.id;
  if (!upgradeId) return;

  const restore = foundry.utils.duplicate(
    carrier.getFlag(MODULE_ID, RESTORE_FLAG) ?? {}
  );
  const previous = restore[upgradeId];
  if (!previous) return;

  const updates = {};
  for (const [path, value] of Object.entries(previous)) {
    if (value !== null) updates[path] = value;
  }

  delete restore[upgradeId];
  updates[`flags.${MODULE_ID}.${RESTORE_FLAG}`] = restore;

  await carrier.update(updates);
}

/**
 * Подключает правку носителя к установке и снятию модификаций.
 *
 * Обёртки навешиваются на экземпляр предмета, потому что система назначает
 * `installItems` и `uninstallItems` там же, где остальные функции миксинов —
 * в `loadMixins()`. Правки применяются строго после того, как отработал
 * системный код: он сам обновляет список установленного, и лезть в предмет
 * одновременно с ним значит получить гонку обновлений.
 *
 * @param {Item} item - предмет, которому загрузили миксины
 */
export function applyCarrierPatches(item) {
  if (typeof item.installItems === "function") {
    const systemInstall = item.installItems;
    item.installItems = async (itemList) => {
      const result = await systemInstall.call(item, itemList);
      if (result === false) return result;
      for (const upgrade of itemList ?? []) {
        try {
          await applyCarrierChanges(item, upgrade);
        } catch (err) {
          console.error(
            `${MODULE_ID} | Не удалось применить правки «${upgrade?.name}» к «${item.name}»`,
            err
          );
        }
      }
      return result;
    };
  }

  if (typeof item.uninstallItems === "function") {
    const systemUninstall = item.uninstallItems;
    item.uninstallItems = async (uninstallList, ...rest) => {
      // Откатываем до вызова системы: после снятия предмет уже не числится
      // установленным, а нам нужно вернуть поля именно в этот момент.
      for (const upgrade of uninstallList ?? []) {
        try {
          await revertCarrierChanges(item, upgrade);
        } catch (err) {
          console.error(
            `${MODULE_ID} | Не удалось откатить правки «${upgrade?.name}» у «${item.name}»`,
            err
          );
        }
      }
      return systemUninstall.call(item, uninstallList, ...rest);
    };
  }
}

/**
 * Человекочитаемая сводка правок — для карточки предмета.
 *
 * @param {Item} upgrade - модификация
 * @returns {Array<String>} - строки вида «Автоогонь: 3»
 */
export function describeCarrierChanges(upgrade) {
  const changes = getCarrierChanges(upgrade);
  const labels = {
    "system.fireModes.autoFire": localize("changes.autoFire"),
    "system.fireModes.suppressiveFire": localize("changes.suppressiveFire"),
    "system.ammoVariety": localize("changes.ammoVariety"),
    "system.dvTable": localize("changes.dvTable"),
    "system.weaponType": localize("changes.weaponType"),
    "system.installedItems.slots": localize("changes.slots"),
    "system.handsReq": localize("changes.handsReq"),
  };

  return Object.entries(changes).map(([path, change]) => {
    const label = labels[path] ?? path.replace(/^system\./, "");
    const value = Array.isArray(change.value)
      ? change.value.join(", ")
      : String(change.value);
    const prefix = change.op === "inc" && Number(change.value) > 0 ? "+" : "";
    return `${label}: ${prefix}${value}`;
  });
}

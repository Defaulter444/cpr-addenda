/**
 * Публичный API модуля — то, что можно звать из макросов и чужих модулей.
 */

import { MODULE_ID, FLAGS } from "./constants.js";
import { getWeaponTypes } from "./cpr-config.js";

/**
 * Размечает модификацию: в оружие каких типов её можно (или нельзя) ставить.
 *
 * Списки взаимоисключающие. Передан `allowed` — работает белый список,
 * передан `denied` — чёрный. Пустые списки снимают ограничение.
 *
 * @async
 * @param {Item} item - модификация (`itemUpgrade`)
 * @param {Object} options
 *   @param {Array<String>} options.allowed - ключи разрешённых типов оружия
 *   @param {Array<String>} options.denied - ключи запрещённых типов оружия
 * @returns {Promise<Item>}
 */
export async function setWeaponTypes(item, { allowed = [], denied = [] } = {}) {
  if (item?.type !== "itemUpgrade") {
    throw new Error(
      `${MODULE_ID} | Ограничения по типам оружия ставятся только на модификации (itemUpgrade).`
    );
  }

  const known = Object.keys(getWeaponTypes());
  const unknown = [...allowed, ...denied].filter((t) => !known.includes(t));
  if (unknown.length) {
    throw new Error(
      `${MODULE_ID} | Неизвестные типы оружия: ${unknown.join(", ")}`
    );
  }

  if (allowed.length && denied.length) {
    throw new Error(
      `${MODULE_ID} | Нельзя задать белый и чёрный список одновременно.`
    );
  }

  return item.update({
    [`flags.${MODULE_ID}.${FLAGS.allowedWeaponTypes}`]: allowed,
    [`flags.${MODULE_ID}.${FLAGS.deniedWeaponTypes}`]: denied,
  });
}

/**
 * Показывает, что мешает модификациям и таблицам работать.
 *
 * Когда «ничего не происходит», причин обычно три, и все они снаружи не видны:
 * настройка таблиц указывает на системный пак, у предмета-носителя выключен
 * приём установки, или предмет открыт из компендиума, где его нельзя менять.
 * Вместо того чтобы гадать, выводим состояние как есть.
 *
 * Вызывается из консоли: `game.cprAddenda.diagnose()`
 * или с предметом: `game.cprAddenda.diagnose(item)`
 *
 * @param {Item} [item] - предмет, о котором хочется знать подробности
 * @returns {Object} - те же данные объектом, если нужно посмотреть глубже
 */
export function diagnose(item = null) {
  const lines = [];
  const report = {};

  const dvSetting = (() => {
    try {
      return game.settings.get(game.system.id, "dvRollTableCompendium");
    } catch {
      return "(настройки нет)";
    }
  })();
  const ourPack = `${MODULE_ID}.addenda-dv-tables`;
  report.dvCompendium = dvSetting;
  report.dvIsOurs = dvSetting === ourPack;
  lines.push(
    `Компендиум таблиц СЛ: ${dvSetting}` +
      (report.dvIsOurs
        ? "  ✔ таблицы модуля работают"
        : "  ✘ таблицы модуля НЕ используются — game.cprAddenda.switchToModuleTables()")
  );

  const pack = game.packs.get(ourPack);
  report.tablesFound = pack ? pack.index.size : 0;
  lines.push(`Таблиц в паке модуля: ${report.tablesFound}`);

  report.libWrapper = Boolean(globalThis.libWrapper);
  lines.push(`libWrapper: ${report.libWrapper ? "есть" : "НЕТ — механика не работает"}`);

  // Что именно модуль сейчас перехватывает. Первое трогает только подготовку
  // данных предмета, второе — единственное вмешательство в бросок.
  const patches = {
    "правки носителя и ограничения установки": true,
    "замена штрафа прицеливания": game.settings.get(MODULE_ID, "aimedShotPatch"),
  };
  report.patches = patches;
  lines.push("Перехваты модуля:");
  for (const [name, on] of Object.entries(patches)) {
    lines.push(`  ${on ? "включён " : "выключен"} — ${name}`);
  }

  report.dice3d = Boolean(globalThis.game?.dice3d);
  lines.push(
    `Dice So Nice: ${report.dice3d ? "подключён" : "не найден — 3D-кубиков не будет"}`
  );

  if (item) {
    const container = item.system?.installedItems;
    report.item = {
      name: item.name,
      type: item.type,
      inCompendium: Boolean(item.pack),
      accepts: Boolean(container?.allowed),
      slots: container?.slots ?? 0,
      installed: container?.list?.length ?? 0,
      carrierChanges: item.getFlag(MODULE_ID, "carrierChanges") ?? null,
      restoreStored: item.getFlag(MODULE_ID, "carrierRestore") ?? null,
      dvTable: item.system?.dvTable ?? null,
    };
    lines.push("");
    lines.push(`Предмет: ${item.name} [${item.type}]`);
    if (item.pack) {
      lines.push("  ✘ открыт из компендиума — установка работает только с копией в мире или у персонажа");
    }
    if (container) {
      lines.push(
        `  приём установки: ${container.allowed ? "включён" : "ВЫКЛЮЧЕН"}, слотов: ${container.slots ?? 0}`
      );
    }
    if (report.item.dvTable !== null) {
      const known = pack?.index.some((t) => t.name === report.item.dvTable);
      lines.push(
        `  таблица дальности: "${report.item.dvTable}"` +
          (report.item.dvTable === ""
            ? ""
            : known
            ? "  ✔ есть в паке модуля"
            : "  ✘ в паке модуля такой таблицы нет")
      );
    }
    if (report.item.carrierChanges) {
      lines.push(`  меняет у носителя: ${Object.keys(report.item.carrierChanges).join(", ")}`);
    }
    if (report.item.restoreStored) {
      lines.push(
        `  хранит откат для модификаций: ${Object.keys(report.item.restoreStored).length}`
      );
    }
  }

  console.log(`${MODULE_ID} | диагностика\n${lines.join("\n")}`);
  ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM"),
    content: `<div class="cpr-addenda-hint"><h3>Addenda: диагностика</h3><pre style="white-space:pre-wrap">${lines.join("\n")}</pre></div>`,
  });
  return report;
}

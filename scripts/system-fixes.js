/**
 * Правка расхождений в данных самой системы.
 *
 * У нескольких предметов компендиума числа не сходятся с книгой, и притом
 * молча: описание обещает одно, а поле хранит другое. Заметить это можно
 * только уперевшись — когда пятый киберглаз некуда поставить.
 *
 * Компендиум системы править нельзя: он лежит в её папке и перезапишется при
 * первом же обновлении. Поэтому правим на лету — в тот момент, когда предмет
 * кладут на лист. Для тех, кто уже разложен по листам, есть отдельный проход
 * в переносе данных.
 *
 * Каждая правка объясняет, на чём основана, и срабатывает только если поле
 * действительно содержит старое значение. Если систему однажды починят, наши
 * правки просто перестанут находить, что чинить, — и ничего не сломают.
 *
 * Предметы узнаём по ссылке на компендиум, а не по имени: при включённом
 * Babele имя приезжает уже переведённым, и совпадение по строке развалилось бы
 * от смены языка.
 */

import { MODULE_ID, SYSTEM_ID, SETTINGS, localize } from "./constants.js";

/**
 * Что и почему правим.
 *
 * `uuid` — откуда предмет родом. `test` отвечает, нужна ли правка этому
 * конкретному предмету; `patch` возвращает объект изменений для `updateSource`.
 */
const FIXES = [
  {
    id: "multiOpticMount",
    uuid: "Compendium.cyberpunk-red-core.core_cyberware.Item.Iu2wDz9q6Ov0UAKo",
    // «Фасеточное крепление»: собственное описание предмета в системе гласит
    // «Allows you to install up to 5 more cybereyes», и Data Pool говорит
    // то же — «до 5 дополнительных киберглаз». В поле слотов при этом 3.
    what: "multiOptic",
    test: (item) => item.system?.installedItems?.slots === 3,
    patch: () => ({ "system.installedItems.slots": 5 }),
  },
  {
    id: "sensorArray",
    uuid: "Compendium.cyberpunk-red-core.core_cyberware.Item.eapyCpVJd8BdGPMU",
    // «Сенсорный массив»: описание — «up to 5 more cyberaudio options»,
    // Data Pool — «до 5 дополнительных опций Кибераудио». В поле 3.
    what: "sensorArray",
    test: (item) => item.system?.installedItems?.slots === 3,
    patch: () => ({ "system.installedItems.slots": 5 }),
  },
  {
    id: "fumaKotaro",
    uuid: "Compendium.cyberpunk-red-core.black-chrome_cyberware.Item.nH3p5XdyArI2faqK",
    // Остов «Фума Котаро» даёт «проверки навыка Скрытности на +2». Эффект у
    // предмета есть, но в нём только ТЕЛ 12 — прибавки к Скрытности нет.
    what: "fumaStealth",
    test: (item) =>
      !(item.effects ?? []).some((e) =>
        (e.changes ?? []).some((c) => c.key === "bonuses.stealth")
      ),
    patch: (item) => ({
      effects: [
        ...(item.toObject().effects ?? []),
        {
          name: localize("fixes.fumaStealth.effect"),
          img: item.img,
          type: "base",
          disabled: false,
          transfer: true,
          changes: [{ key: "bonuses.stealth", mode: 2, value: "2", priority: null }],
          // Флаги системы обязательны. Cyberpunk RED читает
          // `flags.cyberpunk-red-core.changes.cats` без проверки, и эффект без
          // них роняет отрисовку листа целиком — лист перестаёт открываться.
          flags: {
            [SYSTEM_ID]: {
              changes: {
                cats: { 0: "skill" },
                situational: { 0: { isSituational: false, onByDefault: false } },
              },
            },
            [MODULE_ID]: { systemFix: "fumaKotaro" },
          },
        },
      ],
    }),
  },
];

/** Ссылка на компендиум, откуда предмет родом. */
function sourceUuid(item) {
  return (
    item?._stats?.compendiumSource ??
    item?.flags?.core?.sourceId ??
    null
  );
}

/**
 * Подбирает правку для предмета, если она ему нужна.
 *
 * @param {Object} item - предмет: документ или его данные
 * @returns {Object|null} - {fix, changes} или null
 */
export function fixFor(item) {
  const uuid = sourceUuid(item);
  if (!uuid) return null;
  const fix = FIXES.find((f) => f.uuid === uuid);
  if (!fix || !fix.test(item)) return null;
  return { fix, changes: fix.patch(item) };
}

/**
 * Правит предмет в момент, когда его кладут на лист.
 *
 * Работаем на `preCreateItem`: до записи в базу правка бесплатна, а после
 * потребовала бы второго обращения к серверу и мигания на листе.
 *
 * @param {CPRItem} item - создаваемый предмет
 * @returns {void}
 */
export function fixOnCreate(item) {
  if (!game.settings.get(MODULE_ID, SETTINGS.systemFixes)) return;
  const found = fixFor(item);
  if (!found) return;
  item.updateSource(found.changes);
  ui.notifications.info(
    localize(`fixes.${found.fix.what}.applied`, { name: item.name })
  );
}

/**
 * Проходит по уже разложенным предметам.
 *
 * Компендиум мы правим на лету, но то, что легло на листы раньше, так и
 * останется с прежними числами. Здесь и правим — по тем же условиям, что и
 * при создании, поэтому повторный проход ничего не испортит.
 *
 * @param {CPRActor} actor - проверяемый актёр
 * @param {Object} stats - счётчики переноса
 * @returns {Promise<void>}
 */
export async function fixActorItems(actor, stats) {
  const updates = [];
  for (const item of actor.items) {
    const found = fixFor(item);
    if (found) updates.push({ _id: item.id, ...found.changes });
  }
  if (!updates.length) return;
  await actor.updateEmbeddedDocuments("Item", updates);
  stats.fixes += updates.length;
}

/** Внутренности для самопроверки. */
export const __test = { FIXES, fixFor, sourceUuid };

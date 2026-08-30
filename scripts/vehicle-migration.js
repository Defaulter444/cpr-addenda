/**
 * Перенос данных транспорта из отдельного модуля VAS.
 *
 * Лист приехал из модуля `mmutons-cyberpunk-red-vas`, и всё, что игроки успели
 * настроить, лежит во флагах с его именем. Оставить их там нельзя: Foundry
 * проверяет пространство флагов по списку включённых модулей, и после
 * отключения VAS первое же `setFlag` бросит «Flag scope is not valid or not
 * currently active». Машины перестанут сохраняться, а собранные посты
 * пропадут с листа.
 *
 * Поэтому флаги переезжают в пространство `cpr-addenda`. Читаем их напрямую из
 * `doc.flags`, а не через `getFlag`: тот проверяет пространство ровно так же и
 * упал бы на выключенном модуле — то есть именно тогда, когда перенос и нужен.
 *
 * Старые флаги не удаляются. Они ничего не весят и никого не трогают, зато
 * если что-то пойдёт не так, исходные данные останутся на месте.
 */

import {
  MODULE_ID,
  SETTINGS,
  VAS_MODULE_ID,
  VEHICLE_FLAGS,
  localize,
} from "./constants.js";

/**
 * Версия переноса. Растёт, если однажды придётся переносить что-то ещё, —
 * тогда миры, прошедшие прошлый перенос, пройдут и новый.
 */
const MIGRATION_VERSION = 2;

/** Как звались флаги в оригинале → как зовутся теперь. */
const FLAG_MAP = {
  positions: VEHICLE_FLAGS.positions,
  speed: VEHICLE_FLAGS.speed,
  permissionsSynced: VEHICLE_FLAGS.synced,
  mountedPosition: VEHICLE_FLAGS.mountedPosition,
  mounted: VEHICLE_FLAGS.mounted,
  installed: VEHICLE_FLAGS.installed,
  managedBy: VEHICLE_FLAGS.managedBy,
  positionId: VEHICLE_FLAGS.positionId,
  occupantMovePos: VEHICLE_FLAGS.occupantMovePos,
};

/**
 * Что нужно дописать документу, чтобы он жил в новом пространстве флагов.
 *
 * @param {Document} doc - актёр, предмет или активный эффект
 * @returns {Object|null} - объект флагов или null, если переносить нечего
 */
function pendingFlags(doc) {
  const old = doc?.flags?.[VAS_MODULE_ID];
  if (!old || typeof old !== "object") return null;

  const own = doc.flags?.[MODULE_ID] ?? {};
  const moved = {};
  for (const [from, to] of Object.entries(FLAG_MAP)) {
    if (!(from in old)) continue;
    // Уже перенесённое не трогаем: повторный запуск не должен затирать то,
    // что мастер успел поправить на новом листе.
    if (own[to] !== undefined) continue;
    moved[to] = foundry.utils.deepClone(old[from]);
  }
  return Object.keys(moved).length > 0 ? moved : null;
}

/**
 * Переносит флаги одного актёра вместе с его предметами и эффектами.
 *
 * @param {CPRActor} actor - актёр
 * @param {Object} stats - счётчики для отчёта
 * @returns {Promise<void>}
 */
async function migrateActor(actor, stats) {
  const actorFlags = pendingFlags(actor);
  if (actorFlags) {
    await actor.update({ flags: { [MODULE_ID]: actorFlags } });
    stats.actors += 1;
  }

  const itemUpdates = [];
  for (const item of actor.items) {
    const flags = pendingFlags(item);
    if (flags) itemUpdates.push({ _id: item.id, flags: { [MODULE_ID]: flags } });
  }
  if (itemUpdates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", itemUpdates, { render: false });
    stats.items += itemUpdates.length;
  }

  const effectUpdates = [];
  for (const effect of actor.effects) {
    const flags = pendingFlags(effect);
    if (flags) {
      effectUpdates.push({ _id: effect.id, flags: { [MODULE_ID]: flags } });
    }
  }
  if (effectUpdates.length > 0) {
    await actor.updateEmbeddedDocuments("ActiveEffect", effectUpdates, {
      render: false,
    });
    stats.effects += effectUpdates.length;
  }
}

/**
 * Переносит данные листа транспорта, если этого ещё не делали.
 *
 * Идёт по актёрам мира и по несвязанным токенам сцен: у несвязанного токена
 * своя копия актёра, и настроенные на нём посты живут отдельно от мировых.
 *
 * @returns {Promise<void>}
 */
/**
 * Выдаёт костюму бронеплиты, если их у него нет.
 *
 * ОС в шапке листа — только показания приборов. Урон система считает по
 * надетым предметам брони: `_applyDamage` спрашивает `getEquippedArmors` и
 * берёт ОС оттуда. Костюмы первых сборок приезжали без такого предмета, и при
 * попадании у них не вычиталось ничего — заполненная шапка при этом выглядела
 * убедительно, так что заметить это можно было только по числам урона.
 *
 * Трогаем только тех, у кого предмета брони нет вовсе: свою броню, если мастер
 * её завёл руками, перезаписывать нельзя. ОС берём из шапки самого костюма —
 * так переживут и переименование, и правку значения.
 *
 * @param {CPRActor} actor - проверяемый актёр
 * @param {Object} stats - счётчики переноса
 * @returns {Promise<void>}
 */
async function migrateArmorPlates(actor, stats) {
  if (actor.type !== "character") return;
  // Костюм узнаём по посадочным постам: они есть только у наших актёров и у
  // транспорта, заведённого через этот лист.
  const positions = actor.flags?.[MODULE_ID]?.[VEHICLE_FLAGS.positions];
  if (!Array.isArray(positions) || positions.length === 0) return;
  if (actor.items.some((i) => i.type === "armor")) return;

  const sp = Number(actor.system?.externalData?.currentArmorBody?.value);
  if (!Number.isInteger(sp) || sp <= 0) return;

  await actor.createEmbeddedDocuments("Item", [
    {
      name: localize("vehicle.migration.armorName"),
      type: "armor",
      img: `modules/${MODULE_ID}/assets/icons/armor.svg`,
      system: {
        description: { value: localize("vehicle.migration.armorText", { sp }) },
        equipped: "equipped",
        isBodyLocation: true,
        isHeadLocation: true,
        isShield: false,
        bodyLocation: { sp, ablation: 0 },
        headLocation: { sp, ablation: 0 },
        penalty: 0,
      },
      flags: { [MODULE_ID]: { [VEHICLE_FLAGS.installed]: true } },
    },
  ]);
  stats.armor += 1;
}

export async function migrateVehicleData() {
  if (!game.user.isGM) return;

  const done = game.settings.get(MODULE_ID, SETTINGS.vehicleMigration);
  if (done >= MIGRATION_VERSION) return;

  const stats = { actors: 0, items: 0, effects: 0, armor: 0 };

  try {
    for (const actor of game.actors) {
      await migrateActor(actor, stats);
      await migrateArmorPlates(actor, stats);
    }

    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        // Связанный токен смотрит в мирового актёра — он уже обработан выше.
        if (token.isLinked || !token.actor) continue;
        await migrateActor(token.actor, stats);
        await migrateArmorPlates(token.actor, stats);
      }
    }

    await game.settings.set(
      MODULE_ID,
      SETTINGS.vehicleMigration,
      MIGRATION_VERSION
    );

    const total = stats.actors + stats.items + stats.effects + stats.armor;
    if (total > 0) {
      ui.notifications.info(localize("vehicle.migration.done", stats));
    }
    console.log(
      `${MODULE_ID} | перенос данных транспорта: актёров ${stats.actors}, предметов ${stats.items}, эффектов ${stats.effects}, бронеплит ${stats.armor}`
    );
  } catch (error) {
    // Отметку не ставим: следующая загрузка попробует снова, а уже
    // перенесённое не пострадает — pendingFlags пропускает готовое.
    console.error(`${MODULE_ID} | перенос данных транспорта не завершён:`, error);
    ui.notifications.error(localize("vehicle.migration.failed"));
  }
}

/**
 * Предупреждает, если исходный модуль всё ещё включён.
 *
 * Оба модуля вешают свои хуки на одни и те же события и оба раздают активные
 * эффекты. После переноса у пассажира окажется два одинаковых эффекта, и
 * модификаторы поста удвоятся — заметить это в бою почти невозможно.
 */
export function warnAboutVasModule() {
  if (!game.user.isGM) return;
  if (!game.modules.get(VAS_MODULE_ID)?.active) return;
  ui.notifications.warn(localize("vehicle.notify.oldModuleActive"), {
    permanent: true,
  });
}

/** Внутренности, открытые только для tools/selftest-vehicle.mjs. */
export const __test = {
  pendingFlags,
  migrateArmorPlates,
  FLAG_MAP,
  MIGRATION_VERSION,
};

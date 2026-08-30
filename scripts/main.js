/**
 * Cyberpunk RED: Addenda — точка входа.
 *
 * Модуль решает две задачи:
 *  1) отдаёт компендиумы с предметами, которых нет в штатной поставке системы;
 *  2) добавляет механику, без которой эти предметы были бы просто текстом:
 *     ограничение установки модификаций по типам оружия и эффекты, живущие
 *     ровно столько, сколько модификация стоит на месте.
 *
 * Принцип совместимости: система и чужие модули не переписываются. Всё, что
 * добавляет модуль, лежит во флагах предметов и в обёртках через libWrapper.
 * Выключите модуль — предметы останутся, механика просто перестанет
 * применяться, ничего не сломается.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { loadSystemConfig } from "./cpr-config.js";
import { registerItemPatches } from "./item-patches.js";
import { registerAimedShotPatch } from "./aimed-shot.js";
import { registerFormulaPatch } from "./roll-formula.js";
import { registerPktHooks, registerPktHumanityPatches } from "./pkt-kit.js";
import { registerSheetHooks } from "./upgrade-sheet.js";
import { registerCarrierHooks } from "./carrier-slots.js";
import {
  checkDvTableSetting,
  registerDvSettings,
  registerDvHooks,
  switchToModuleTables,
  restoreSystemTables,
} from "./dv-tables.js";
import { checkUpgradeFit } from "./install-restrictions.js";
import { buildPackIndex, findMatches } from "./audit.js";
import { setWeaponTypes, diagnose } from "./api.js";
import {
  registerVehicleSettings,
  registerVehicleHelpers,
  registerVehicleHooks,
  reconcileVehiclesOnReady,
} from "./vehicle-registry.js";
import {
  migrateVehicleData,
  warnAboutVasModule,
} from "./vehicle-migration.js";
import { checkCorebook, importCorebook, findCorebookPage } from "./corebook.js";

/**
 * Настройки модуля. Все три — переключатели, потому что мастер должен иметь
 * возможность отключить любую часть механики, не выключая контент.
 *
 * Названия передаём ключами локализации, а не готовым текстом: хук `init`
 * отрабатывает раньше `i18nInit`, и переводы на этот момент ещё не загружены.
 * Foundry локализует ключи сам, когда рисует окно настроек.
 */
function registerSettings() {
  registerDvSettings();
  registerVehicleSettings();
  game.settings.register(MODULE_ID, SETTINGS.enforceWeaponTypes, {
    name: "CPRADDENDA.settings.enforceWeaponTypes.name",
    hint: "CPRADDENDA.settings.enforceWeaponTypes.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.installedUsage, {
    name: "CPRADDENDA.settings.installedUsage.name",
    hint: "CPRADDENDA.settings.installedUsage.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.aimedShotPatch, {
    name: "CPRADDENDA.settings.aimedShotPatch.name",
    hint: "CPRADDENDA.settings.aimedShotPatch.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.importCorebook, {
    name: "CPRADDENDA.settings.importCorebook.name",
    hint: "CPRADDENDA.settings.importCorebook.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.showSheetControls, {
    name: "CPRADDENDA.settings.showSheetControls.name",
    hint: "CPRADDENDA.settings.showSheetControls.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

Hooks.once("init", () => {
  registerSettings();

  if (typeof libWrapper !== "function" && !globalThis.libWrapper) {
    console.error(
      `${MODULE_ID} | libWrapper не найден. Механика модуля не будет работать, компендиумы останутся доступны.`
    );
  } else {
    registerItemPatches();
    // Единственное место, где модуль вмешивается в бросок. Вынесено в
    // отдельную настройку: если что-то пойдёт не так с кубиками или чужими
    // модулями, это выключается само по себе, без отключения всего модуля.
    if (game.settings.get(MODULE_ID, SETTINGS.aimedShotPatch)) {
      registerAimedShotPatch();
    }
  }

  registerSheetHooks();
  registerCarrierHooks();
  registerDvHooks();
  registerPktHooks();

  // Лист транспорта. Живёт отдельно от механики модификаций и не зависит от
  // libWrapper: он ничего не переписывает, а добавляет актёру ещё один вид.
  registerVehicleHelpers();
  registerVehicleHooks();
});

/**
 * Свой каталог переводов для Babele. Регистрация нескольких каталогов от разных
 * модулей — штатный сценарий Babele, так что это не конфликтует с русификацией
 * системы: она переводит свои компендиумы, мы — свои.
 */
Hooks.once("babele.init", (babele) => {
  babele.register({ module: MODULE_ID, lang: "ru", dir: "babele/ru" });
});

Hooks.once("ready", async () => {
  await loadSystemConfig();
  // Ставим до всего прочего: без этого предметы модуля со сложными
  // формулами броска роняют установку.
  await registerFormulaPatch();
  await registerPktHumanityPatches();
  await checkDvTableSetting();

  // Перенос данных транспорта — до сверки эффектов: сверка читает уже новые
  // флаги и без переноса не нашла бы ни одной машины.
  await migrateVehicleData();
  warnAboutVasModule();
  await reconcileVehiclesOnReady();

  // Ссылки на страницы книги ищут её только среди журналов мира, поэтому
  // книгу надо туда положить — иначе в новом мире ссылки просто мертвы.
  await checkCorebook();

  const api = {
    /** Проверка «встанет ли эта модификация в этот предмет». */
    checkUpgradeFit,
    /** Разметить модификацию: в какое оружие её можно ставить. */
    setWeaponTypes,
    /** Собрать индекс всех предметов из всех компендиумов мира. */
    buildPackIndex,
    /** Найти позиции по названию среди уже имеющегося контента. */
    findMatches,
    /** Переключить систему на таблицы дальности модуля. */
    switchToModuleTables,
    /** Вернуть системный компендиум таблиц — перед выключением модуля. */
    restoreSystemTables,
    /** Показать, что мешает установке модификаций и работе таблиц. */
    diagnose,
    /** Положить книгу правил в мир, чтобы заработали ссылки на её страницы. */
    importCorebook,
    /** Найти страницу книги, которую откроют ссылки, или null. */
    findCorebookPage,
  };

  const module = game.modules.get(MODULE_ID);
  module.api = api;
  game.cprAddenda = api;

  console.log(`${MODULE_ID} | Готов. API: game.cprAddenda`);
});

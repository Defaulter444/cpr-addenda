/**
 * Подключение листа транспорта к Foundry.
 *
 * Здесь всё, что нужно сделать один раз при загрузке: настройка, помощник
 * шаблона, регистрация самого листа и хуки, которые держат права и эффекты в
 * порядке, пока лист закрыт.
 *
 * Лист регистрируется как необязательный (`makeDefault: false`): обычные
 * персонажи должны остаться на своём листе, а транспортом актёр становится
 * тогда, когда мастер сам переключит ему вид в шапке.
 */

import { MODULE_ID, SETTINGS, VEHICLE_FLAGS, localize } from "./constants.js";
import { VehicleSheet } from "./vehicle-sheet.js";
import {
  reconcilePermissions,
  reconcileEffects,
  cleanupOrphanedEffects,
} from "./vehicle-effects.js";

/** Листы персонажей системы, рядом с эффектами которых рисуется кнопка «выйти». */
const CPR_ACTOR_SHEETS = ["CPRCharacterActorSheet", "CPRMookActorSheet"];

/**
 * Настройки листа транспорта.
 *
 * Названия передаём ключами, а не готовым текстом: `init` отрабатывает раньше
 * `i18nInit`, переводов на этот момент ещё нет.
 */
export function registerVehicleSettings() {
  game.settings.register(MODULE_ID, SETTINGS.keepGmPermissions, {
    name: "CPRADDENDA.vehicle.settings.keepGmPermissions.name",
    hint: "CPRADDENDA.vehicle.settings.keepGmPermissions.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Служебная отметка, а не переключатель: в окне настроек ей делать нечего.
  game.settings.register(MODULE_ID, SETTINGS.vehicleMigration, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
}

/**
 * Помощник шаблона: выбран ли у оружия такой режим огня.
 *
 * Имя с приставкой модуля намеренно. Помощники Handlebars живут в одном общем
 * пространстве на всю игру, и короткое `cprFireMode` заняли бы сразу два
 * модуля — наш и исходный VAS, если он остался включён. Кто зарегистрируется
 * последним, тот и победил бы, а разбираться потом пришлось бы долго.
 */
export function registerVehicleHelpers() {
  Handlebars.registerHelper(
    "cprAddendaFireMode",
    (actor, mode, weaponId) =>
      actor?.getFlag("cyberpunk-red-core", `firetype-${weaponId}`) === mode
  );
}

/**
 * Хуки, которые держат права и эффекты в порядке.
 *
 * @returns {void}
 */
export function registerVehicleHooks() {
  // Регистрация листа — в setup: к этому моменту переводы уже загружены, и
  // название вида в шапке актёра сразу русское.
  Hooks.once("setup", () => {
    Actors.registerSheet(MODULE_ID, VehicleSheet, {
      types: ["character", "mook"],
      makeDefault: false,
      label: "CPRADDENDA.vehicle.sheetLabel",
    });
  });

  // Рассадку меняет не только лист: мастер правит флаг макросом, игрок
  // выходит из машины со своего листа. Сверяемся на само изменение флага.
  Hooks.on("updateActor", async (actor, changes) => {
    if (!game.user.isGM) return;
    if (
      !foundry.utils.hasProperty(
        changes,
        `flags.${MODULE_ID}.${VEHICLE_FLAGS.positions}`
      )
    ) {
      return;
    }
    await reconcilePermissions(actor);
    await reconcileEffects(actor);
  });

  Hooks.on("deleteActor", async (actor) => {
    if (!game.user.isGM) return;
    if (!actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions)) return;
    await cleanupOrphanedEffects(actor.id);
  });

  Hooks.on("renderActorSheet", (sheet, html) =>
    addEjectButton(sheet, html)
  );
}

/**
 * Добавляет к эффекту от транспорта кнопку «выйти из машины».
 *
 * Эффект нельзя просто удалить: пассажир останется сидеть на посту, и при
 * следующей сверке эффект вернётся. Кнопка делает обе половины дела — снимает
 * эффекты и вычёркивает персонажа из поста.
 *
 * @param {ActorSheet} sheet - лист, который сейчас нарисован
 * @param {jQuery} html - его разметка
 * @returns {void}
 */
function addEjectButton(sheet, html) {
  if (!game.user.isGM) return;
  if (!CPR_ACTOR_SHEETS.includes(sheet.constructor.name)) return;

  const actor = sheet.actor;
  html.find("li.item.effect.flexrow[data-effect-id]").each((index, element) => {
    const effectId = element.dataset.effectId.split(".").pop();
    const effect = actor.effects.get(effectId);
    if (!effect) return;

    const vehicleId = effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy);
    if (!vehicleId) return;
    const positionId = effect.getFlag(MODULE_ID, VEHICLE_FLAGS.positionId);

    const button = document.createElement("a");
    button.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
    button.title = localize("vehicle.crew.eject");
    button.style.cssText =
      "margin-left: 4px; color: var(--cpr-color-red, #b90202); cursor: pointer; padding: 0 4px;";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await ejectFromVehicle(actor, vehicleId, positionId);
    });

    const actions = element.querySelector(".effect-actions");
    if (actions) actions.appendChild(button);
    else element.appendChild(button);
  });
}

/**
 * Высаживает персонажа из транспорта.
 *
 * @param {CPRActor} actor - пассажир
 * @param {String} vehicleId - id актёра-транспорта
 * @param {String} positionId - id поста
 * @returns {Promise<void>}
 */
async function ejectFromVehicle(actor, vehicleId, positionId) {
  const vehicle = game.actors.get(vehicleId);
  if (!vehicle) return;

  const effectIds = actor.effects
    .filter(
      (effect) => effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy) === vehicleId
    )
    .map((effect) => effect.id);
  if (effectIds.length > 0) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
  }

  const positions = foundry.utils.deepClone(
    vehicle.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
  );
  const position = positions.find((pos) => pos.id === positionId);
  if (!position) return;

  position.occupants = (position.occupants || []).filter(
    (uuid) => uuid !== actor.uuid
  );
  await vehicle.setFlag(MODULE_ID, VEHICLE_FLAGS.positions, positions);
}

/**
 * Сверка эффектов при входе в игру.
 *
 * Пока мастера не было, мир мог измениться: удалили транспорт, поменяли
 * характеристики пилота. Проходим по всем, у кого висит наш эффект, и приводим
 * состояние в порядок.
 *
 * @returns {Promise<void>}
 */
export async function reconcileVehiclesOnReady() {
  if (!game.user.isGM) return;

  const vehicleIds = new Set();
  for (const actor of game.actors) {
    for (const effect of actor.effects) {
      const owner = effect.getFlag(MODULE_ID, VEHICLE_FLAGS.managedBy);
      if (owner) vehicleIds.add(owner);
    }
  }
  if (vehicleIds.size === 0) return;

  for (const vehicleId of vehicleIds) {
    const vehicle = game.actors.get(vehicleId);
    if (vehicle) await reconcileEffects(vehicle);
    else await cleanupOrphanedEffects(vehicleId);
  }
}

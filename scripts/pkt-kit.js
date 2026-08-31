/**
 * Комплекты корпусов ПКТ.
 *
 * Корпус полной кибернетической трансформации приходит не один: в документе у
 * каждого расписан комплект из полутора-двух десятков имплантов. Раскладывать
 * его руками — полчаса работы на один корпус, поэтому комплект едет вместе с
 * предметом и разворачивается сам.
 *
 * Системный флаг `cprInstallTree` для этого не годится: он кладёт всё внутрь
 * предмета-носителя, а лист рисует разделы кибернетики по
 * `actor.system.installedItems` — то есть по тому, что установлено в самого
 * персонажа. Комплект, вложенный в корпус, целиком уезжает в «Боргирование»,
 * хотя у киберруки, кибероноги и киберглаза есть собственные графы.
 *
 * Поэтому комплект лежит в своём флаге, а раскладывает его модуль — так же,
 * как это сделал бы игрок вручную:
 *
 *   фундаменты (руки, ноги, глаза, кибераудио, нейролинк) → в персонажа;
 *   опции (подсветка, радио, деки, выкидное оружие)       → в свой фундамент;
 *   покрытия и прочее борговое                            → в сам корпус.
 *
 * Потеря человечности у имплантов комплекта обнулена при сборке: документ
 * задаёт её один раз за весь комплект, строкой у корпуса. Чтобы система не
 * добавляла к этому своё, здесь же живут две обёртки — они не дают ей бросать
 * кубики за содержимое корпуса и снимать максимум человечности повторно.
 */

import { MODULE_ID, SYSTEM_ID, FLAGS, localize } from "./constants.js";

/**
 * Комплект, если предмет его несёт.
 *
 * @param {CPRItem} item - предмет
 * @returns {Object|undefined} - {foundations: [...], carried: [...]}
 */
export function getKit(item) {
  return item?.getFlag?.(MODULE_ID, FLAGS.pktKit);
}

/**
 * Импланты, которые модуль уже развернул из этого корпуса.
 *
 * Принадлежность хранится на самих имплантах, а не в корпусе: список в корпусе
 * пришлось бы чинить каждый раз, когда игрок что-то переставит.
 *
 * @param {CPRActor} actor - владелец
 * @param {String} frameId - идентификатор корпуса на этом актёре
 * @returns {Array<CPRItem>}
 */
export function kitPartsOf(actor, frameId) {
  return actor.items.filter(
    (item) => item.getFlag(MODULE_ID, FLAGS.pktPart)?.frame === frameId
  );
}

/**
 * Разбирает комплект в плоский список к созданию.
 *
 * Порядок здесь — договор с разбором после создания: Foundry возвращает
 * созданные документы в порядке заявки, но полагаться на это одно неуютно,
 * поэтому каждый имплант помечается ещё и номером места.
 *
 * @param {Object} kit - комплект из флага
 * @returns {Array<Object>} - записи {doc, role, group}
 */
export function planKit(kit) {
  const plan = [];
  (kit?.foundations ?? []).forEach((group, index) => {
    plan.push({ doc: group.item, role: "foundation", group: index });
    for (const option of group.options ?? []) {
      plan.push({ doc: option, role: "option", group: index });
    }
  });
  for (const doc of kit?.carried ?? []) {
    plan.push({ doc, role: "carried", group: null });
  }
  return plan;
}

/**
 * Раскладывает комплект корпуса по персонажу.
 *
 * @async
 * @param {CPRItem} frame - корпус, уже созданный на актёре
 * @returns {Number} - сколько имплантов установлено
 */
export async function deployKit(frame) {
  const kit = getKit(frame);
  const actor = frame.parent;
  if (!kit || !(actor instanceof Actor)) return 0;

  // Второй раз не разворачиваем: комплект уже на месте.
  if (kitPartsOf(actor, frame.id).length) return 0;

  const plan = planKit(kit);
  if (!plan.length) return 0;

  const docs = plan.map((entry, index) => {
    const doc = foundry.utils.deepClone(entry.doc);
    delete doc._id;
    doc.flags = {
      ...(doc.flags ?? {}),
      [MODULE_ID]: { [FLAGS.pktPart]: { frame: frame.id, slot: index } },
    };
    return doc;
  });

  // createInstalled: false — разворачивать нечего, вложенность мы соберём
  // сами; без этого система полезет искать свой флаг у каждого импланта.
  const created = await actor.createEmbeddedDocuments("Item", docs, {
    createInstalled: false,
  });

  const bySlot = new Map();
  for (const item of created) {
    const slot = item.getFlag(MODULE_ID, FLAGS.pktPart)?.slot;
    if (slot !== undefined) bySlot.set(slot, item);
  }

  const groups = (kit.foundations ?? []).map(() => ({ host: null, options: [] }));
  const carried = [];
  plan.forEach((entry, index) => {
    const item = bySlot.get(index);
    if (!item) return;
    if (entry.role === "foundation") groups[entry.group].host = item;
    else if (entry.role === "option") groups[entry.group].options.push(item);
    else carried.push(item);
  });

  // Сначала опции в фундаменты, потом фундаменты в персонажа: так у листа ни
  // на одном шаге не окажется фундамента с опциями, висящими в воздухе.
  for (const { host, options } of groups) {
    if (host && options.length) await host.installItems(options);
  }
  if (carried.length) await frame.installItems(carried);

  const hosts = groups.map((group) => group.host).filter(Boolean);
  if (hosts.length) await actor.installItems(hosts);

  return created.length;
}

/**
 * Убирает комплект вместе с корпусом.
 *
 * @async
 * @param {CPRItem} frame - удаляемый корпус
 * @returns {Number} - сколько имплантов убрано
 */
export async function removeKit(frame) {
  const actor = frame.parent;
  if (!(actor instanceof Actor)) return 0;

  const parts = kitPartsOf(actor, frame.id)
    .map((item) => item.id)
    // Часть система могла удалить сама, разбирая содержимое корпуса.
    .filter((id) => actor.items.has(id));
  if (!parts.length) return 0;

  await actor.deleteEmbeddedDocuments("Item", parts);
  return parts.length;
}

/**
 * Пересчитывает максимум человечности без учёта комплекта.
 *
 * Система снимает по четыре очка максимума за каждый борговый имплант и по два
 * за любой другой с ненулевой статической потерей. Для комплекта это двойной
 * счёт: документ уже назначил корпусу одну общую потерю, включающую всё
 * содержимое. Штрафы за импланты комплекта возвращаются обратно, штраф за сам
 * корпус остаётся.
 *
 * @param {Number} base - что насчитала система
 * @param {CPRActor} actor - персонаж
 * @returns {Number}
 */
export function refundKitHumanity(base, actor) {
  let refund = 0;
  for (const item of actor.items) {
    if (!item.getFlag?.(MODULE_ID, FLAGS.pktPart)) continue;
    if (item.type !== "cyberware" || !item.system.isInstalledInActor) continue;

    if (item.system.type === "borgware") refund += 4;
    else if (parseInt(item.system.humanityLoss?.static, 10) > 0) refund += 2;
  }
  return base + refund;
}

/**
 * Хуки разворачивания и уборки комплекта.
 */
export function registerPktHooks() {
  Hooks.on("createItem", async (item, options, userId) => {
    // Создание отрабатывает у всех клиентов, а делать это должен один.
    if (game.user.id !== userId || !getKit(item)) return;
    if (!(item.parent instanceof Actor)) return;
    try {
      // Комплект больше не разворачивается молча: полная конверсия тела —
      // необратимая операция на два десятка имплантов и три десятка очков
      // человечности, и увидеть, на что идёшь, надо до неё, а не после.
      const { runPktWizard } = await import("./pkt-wizard.js");
      const installed = await runPktWizard(item);
      if (installed) {
        ui.notifications.info(
          localize("pkt.deployed", {
            frame: item.name,
            count: kitPartsOf(item.parent, item.id).length,
          })
        );
        return;
      }
      // Отказ на любом шаге отменяет и саму установку: оставлять корпус
      // лежать на листе, когда игрок сказал «нет», — значит сделать половину
      // того, от чего он отказался.
      if (item.parent.items.has(item.id)) {
        await item.parent.deleteEmbeddedDocuments("Item", [item.id]);
      }
      ui.notifications.info(localize("pkt.cancelled", { frame: item.name }));
    } catch (err) {
      console.error(`${MODULE_ID} | Не удалось развернуть комплект корпуса`, err);
      ui.notifications.error(localize("pkt.failed", { frame: item.name }));
    }
  });

  Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId || !getKit(item)) return;
    try {
      const count = await removeKit(item);
      if (count) {
        ui.notifications.info(
          localize("pkt.removed", { frame: item.name, count })
        );
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Не удалось убрать комплект корпуса`, err);
    }
  });
}

/**
 * Обёртки, которые не дают системе списать человечность за комплект дважды.
 *
 * @async
 */
export async function registerPktHumanityPatches() {
  let CPRActor;
  try {
    const module = await import(
      `/systems/${SYSTEM_ID}/modules/actor/cpr-actor.js`
    );
    CPRActor = module.default ?? module.CPRActor;
  } catch (err) {
    console.warn(
      `${MODULE_ID} | Класс актёра недоступен: человечность за комплект ПКТ будет считаться дважды.`,
      err
    );
    return;
  }
  if (!CPRActor?.prototype?.installCyberware) return;

  // libWrapper адресует обёртки от globalThis, а классы системы наружу не
  // выставлены — публикуем ссылку под своим именем.
  globalThis.cprAddendaActorClass = CPRActor;

  // 1. Установка корпуса: система накапливает формулы всех вложенных имплантов
  //    и бросает кубик за каждый. У корпуса ПКТ своя формула из книги, и она
  //    уже включает комплект, поэтому на время установки прячем содержимое.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaActorClass.prototype.installCyberware",
    async function cprAddendaInstallCyberware(wrapped, itemId) {
      const item = this.getOwnedItem(itemId);
      if (!getKit(item)) return wrapped(itemId);

      const original = item.recursiveGetAllInstalledItems;
      item.recursiveGetAllInstalledItems = () => [];
      try {
        return await wrapped(itemId);
      } finally {
        item.recursiveGetAllInstalledItems = original;
      }
    },
    "MIXED"
  );

  // 2. Максимум человечности: возвращаем штрафы за импланты комплекта.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaActorClass.prototype._calcMaxHumanity",
    function cprAddendaMaxHumanity(wrapped, ...args) {
      return refundKitHumanity(wrapped(...args), this);
    },
    "MIXED"
  );

  console.log(`${MODULE_ID} | Комплекты корпусов ПКТ подключены`);
}

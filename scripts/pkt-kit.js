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
 * задаёт её один раз за весь комплект, строкой у корпуса. Предел восстановления
 * считается отдельно: каждый платный имплант уменьшает его на 2 или 4,
 * бесплатные фундаменты и сам предмет-пакет его не уменьшают.
 */

import { MODULE_ID, SYSTEM_ID, FLAGS, SETTINGS, localize } from "./constants.js";
import { activePktFrame, correctMaxHumanity, checkBorgPrerequisites,
  humanityPenalty, isFreePktFoundation, syncBorgArmor, registerBorgActorPatches } from "./pkt-rules.js";

const transactions = new WeakSet();
const clone = value => foundry.utils.deepClone(value);

/** Save only installation/accounting state; unrelated actor data is never rewritten. */
export function snapshotPktState(actor) {
  return { ids: new Set(actor.items.map(i => i.id)),
    installedItems: clone(actor._source?.system?.installedItems ?? actor.system.installedItems),
    humanity: clone(actor._source?.system?.derivedStats?.humanity ?? actor.system.derivedStats.humanity),
    hp: clone(actor._source?.system?.derivedStats?.hp ?? actor.system.derivedStats.hp),
    emp: actor._source?.system?.stats?.emp?.value ?? actor.system.stats.emp.value,
    items: actor.items.map(i => ({ _id: i.id, "system.installedItems": clone(i._source?.system?.installedItems ?? i.system.installedItems),
      ...Object.fromEntries(["pktUsed", "pktUsedBy", "pktSeenItems", "pktBody"].map(key => [
        `flags.${MODULE_ID}.${i.getFlag(MODULE_ID, key) === undefined ? "-=" : ""}${key}`,
        clone(i.getFlag(MODULE_ID, key) ?? null),
      ])) })) };
}

export async function restorePktState(actor, before) {
  // Scrub references before deleting, avoiding the system's parallel uninstall race.
  await actor.updateEmbeddedDocuments("Item", before.items.filter(i => actor.items.has(i._id)));
  await actor.update({ "system.installedItems": before.installedItems });
  const added = actor.items.filter(i => !before.ids.has(i.id)).map(i => i.id);
  if (added.length) await actor.deleteEmbeddedDocuments("Item", added, { cprIsMigrating: true });
  await actor.update({ "system.derivedStats.humanity": before.humanity,
    "system.derivedStats.hp": before.hp, "system.stats.emp.value": before.emp });
}

function frameRoots(frame) {
  const ids = new Set(frame.parent.system.installedItems.list);
  return [frame, ...kitPartsOf(frame.parent, frame.id), ...extraPktParts(frame)].filter(i => ids.has(i.id));
}

function extraPktParts(frame) {
  return frame.parent.items.filter(i => i.getFlag(MODULE_ID, "pktBody")?.frame === frame.id);
}

/** Includes user-added options attached to the body's existing foundations. */
export function pktContents(frame) {
  const actor = frame.parent;
  const roots = [frame, ...extraPktParts(frame), ...kitPartsOf(actor, frame.id).filter(i => {
    const slot = i.getFlag(MODULE_ID, FLAGS.pktPart)?.slot;
    return planKit(getKit(frame))[slot]?.role === "foundation";
  })];
  const ids = new Set(roots.map(i => i.id));
  for (const id of ids) for (const child of actor.items.get(id)?.system.installedItems?.list ?? []) ids.add(child);
  return [...ids].map(id => actor.items.get(id)).filter(i => i && i.id !== frame.id);
}

export function hasUsedPktFrame(frame) {
  return Boolean(frame.getFlag(MODULE_ID, "pktUsed") && frame.getFlag(MODULE_ID, "pktUsedBy") === frame.parent?.id);
}

export function pendingPktItems(frame) {
  if (!hasUsedPktFrame(frame)) return [];
  const known = new Set(frame.getFlag(MODULE_ID, "pktSeenItems") ?? kitPartsOf(frame.parent, frame.id).map(i => i.id));
  return pktContents(frame).filter(i => i.type === "cyberware" && !known.has(i.id) && !isFreePktFoundation(i));
}

/** Remove a body as a whole while keeping its options and original item IDs. */
export async function uninstallPktFrame(frame) {
  const actor = frame.parent;
  const roots = frameRoots(frame);
  if (roots.length) await actor.uninstallItems(roots, { recursive: false, unloadAmmo: false });
  for (const item of extraPktParts(frame)) {
    if (!item.system.isInstalledInActor) continue;
    const host = actor.items.get(item.system.installedIn[0]);
    if (host) await host.uninstallItems([item], { recursive: false, unloadAmmo: false });
  }
  await actor.setMaxHumanity();
  return true;
}

/** Transaction boundary used by both the wizard and reinstalling an existing body. */
export async function installPktFrame(frame, chosen = { type: "none", value: 0 }) {
  const actor = frame.parent;
  const prerequisite = checkBorgPrerequisites(actor, frame);
  if (!prerequisite.ok) { ui.notifications.warn(prerequisite.reason); return false; }
  if (transactions.has(actor)) throw new Error("Установка корпуса ПКТ уже выполняется.");
  if (frame.system.isInstalledInActor) return true;
  transactions.add(actor);
  const before = snapshotPktState(actor);
  try {
    const priorOwner = frame.getFlag(MODULE_ID, "pktUsedBy");
    if (priorOwner && priorOwner !== actor.id && !kitPartsOf(actor, frame.id).length) {
      await frame.update({ "system.installedItems.list": [], "system.installedItems.usedSlots": 0 });
    }
    const previous = activePktFrame(actor);
    await deployKit(frame);
    if (previous && previous.id !== frame.id) await uninstallPktFrame(previous);
    const roots = kitPartsOf(actor, frame.id).filter(i => {
      const slot = i.getFlag(MODULE_ID, FLAGS.pktPart)?.slot;
      return planKit(getKit(frame))[slot]?.role === "foundation";
    });
    if (!(await actor.installItems([frame, ...roots]))) throw new Error("Система отказала в установке корпуса ПКТ.");
    for (const item of extraPktParts(frame)) {
      if (item.system.isInstalledInActor) continue;
      const target = item.getFlag(MODULE_ID, "pktBody")?.target;
      const host = target === actor.id ? actor : actor.items.get(target);
      if (!host || !(await host.installItems([item]))) throw new Error(`Не удалось вернуть имплант корпуса: ${item.name}`);
    }
    if (![frame, ...roots].every(i => i.system.isInstalledInActor)) throw new Error("Корпус установлен не полностью.");
    await syncBorgArmor(actor);
    const { applyHumanity } = (await import("./pkt-wizard.js")).__test;
    // Read the pre-install value: lowering the therapy ceiling must not add a
    // second, implicit humanity charge before applying the chosen package loss.
    const value = Number.isInteger(before.humanity.value) ? before.humanity.value : before.humanity.max;
    const reused = hasUsedPktFrame(frame);
    const charge = reused && !pendingPktItems(frame).length ? { type: "none", value: 0 } : chosen;
    if (charge?.value) await applyHumanity(actor, charge, value);
    else {
      await actor.update({ "system.derivedStats.humanity.max": actor._calcMaxHumanity(),
        "system.derivedStats.humanity.value": Math.min(value, actor._calcMaxHumanity()) });
      await actor.setMaxHumanity();
    }
    const max = actor.calcMaxHp();
    await actor.update({ "system.derivedStats.hp.max": max, "system.derivedStats.hp.value": max });
    await frame.setFlag(MODULE_ID, "pktUsed", true);
    await frame.setFlag(MODULE_ID, "pktUsedBy", actor.id);
    await frame.setFlag(MODULE_ID, "pktSeenItems", pktContents(frame).map(i => i.id));
    return true;
  } catch (error) {
    await restorePktState(actor, before);
    throw error;
  } finally { transactions.delete(actor); }
}

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
  const existing = kitPartsOf(actor, frame.id);
  if (existing.length) {
    if (existing.length !== planKit(kit).length) throw new Error("Комплект ПКТ неполон; восстановите удалённые части перед установкой.");
    return 0;
  }

  const plan = planKit(kit);
  if (!plan.length) return 0;

  const docs = plan.map((entry, index) => {
    const doc = foundry.utils.deepClone(entry.doc);
    delete doc._id;
    doc.flags = {
      ...(doc.flags ?? {}),
      [MODULE_ID]: { ...(doc.flags?.[MODULE_ID] ?? {}), [FLAGS.pktPart]: { frame: frame.id, slot: index } },
    };
    return doc;
  });

  // createInstalled: false — разворачивать нечего, вложенность мы соберём
  // сами; без этого система полезет искать свой флаг у каждого импланта.
  const created = await actor.createEmbeddedDocuments("Item", docs, {
    createInstalled: false,
    CPRsplitStack: true,
  });
  if (created.length !== docs.length) throw new Error("Созданы не все части комплекта ПКТ.");

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
    if (host && options.length && !(await host.installItems(options))) throw new Error(`Не удалось установить опции: ${host.name}`);
  }
  if (carried.length && !(await frame.installItems(carried))) throw new Error(`Не удалось установить оснащение: ${frame.name}`);

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

  const deleting = new Set(parts);
  const actorList = actor.system.installedItems.list.filter(id => !deleting.has(id));
  await actor.update({ "system.installedItems.list": actorList });
  const updates = actor.items.filter(i => !deleting.has(i.id) && i.system.installedItems?.list?.some(id => deleting.has(id))).map(i => {
    const list = i.system.installedItems.list.filter(id => !deleting.has(id));
    return { _id: i.id, "system.installedItems.list": list,
      "system.installedItems.usedSlots": list.reduce((sum, id) => sum + (actor.items.get(id)?.system?.size ?? 0), 0) };
  });
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  await actor.deleteEmbeddedDocuments("Item", parts, { cprIsMigrating: true });
  await syncBorgArmor(actor);
  await actor.setMaxHumanity();
  return parts.length;
}

/**
 * Корректирует системный предел восстановления человечности. Учитываются
 * платные импланты действующего тела и Биосистема. Бесплатные фундаменты,
 * неактивные корпуса и сам предмет-пакет не дают дополнительного штрафа.
 *
 * @param {Number} base - что насчитала система
 * @param {CPRActor} actor - персонаж
 * @returns {Number}
 */
export function refundKitHumanity(base, actor) {
  return correctMaxHumanity(base, actor);
}

/**
 * Хуки разворачивания и уборки комплекта.
 */
export function registerPktHooks() {
  Hooks.on("createItem", async (item, options, userId) => {
    // Создание отрабатывает у всех клиентов, а делать это должен один.
    if (game.user.id !== userId || !getKit(item) || options.cprAddendaSkipPktWizard) return;
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
  registerBorgActorPatches(CPRActor);
  // Core 0.92.4 CPRMookActor.create starts super.create without returning or
  // awaiting it. Preserve its token defaults and return the actual document.
  const { default: CPRMookActor } = await import(`/systems/${SYSTEM_ID}/modules/actor/cpr-mook.js`);
  if (/super\.create\(createData, options\);/.test(CPRMookActor.create.toString()) &&
      !/\breturn\b/.test(CPRMookActor.create.toString())) {
    globalThis.cprAddendaMookActorClass = CPRMookActor;
    libWrapper.register(MODULE_ID, "cprAddendaMookActorClass.create",
      function (_wrapped, data, options) {
        const createData = clone(data);
        if (typeof data.system === "undefined") createData.prototypeToken = {
          "sight.enabled": true, bar1: { attribute: "derivedStats.hp" },
        };
        return CPRActor.create.call(this, createData, options);
      }, "MIXED");
  }

  // 1. Установка корпуса: система накапливает формулы всех вложенных имплантов
  //    и бросает кубик за каждый. У корпуса ПКТ своя формула из книги, и она
  //    уже включает комплект, поэтому на время установки прячем содержимое.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaActorClass.prototype.installCyberware",
    async function cprAddendaInstallCyberware(wrapped, itemId) {
      const item = this.getOwnedItem(itemId);
      const prerequisite = checkBorgPrerequisites(this, item);
      if (!prerequisite.ok) { ui.notifications.warn(prerequisite.reason); return false; }
      if (getKit(item)) {
        const { runPktWizard } = await import("./pkt-wizard.js");
        return runPktWizard(item);
      }
      const free = activePktFrame(this) && humanityPenalty(item, this) === 0;
      const humanityLoss = item.system.humanityLoss;
      if (free) item.system.humanityLoss = { roll: "0", static: 0 };
      let result;
      try { result = await wrapped(itemId); }
      finally { if (free) item.system.humanityLoss = humanityLoss; }
      if (result) await syncBorgArmor(this);
      const frame = activePktFrame(this);
      if (result && frame) {
        if (!item.getFlag(MODULE_ID, FLAGS.pktPart)) await item.setFlag(MODULE_ID, "pktBody", { frame: frame.id, target: item.system.installedIn[0] });
        await frame.setFlag(MODULE_ID, "pktSeenItems", pktContents(frame).map(i => i.id));
      }
      return result;
    },
    "MIXED"
  );

  if (CPRActor.prototype.uninstallCyberware) libWrapper.register(MODULE_ID,
    "cprAddendaActorClass.prototype.uninstallCyberware",
    async function (wrapped, itemId, foundationalId, skipConfirm = false) {
      const item = this.getOwnedItem(itemId);
      if (!getKit(item)) return wrapped(itemId, foundationalId, skipConfirm);
      // The original method owns the confirmation dialog. Its cancellation
      // leaves the body installed, so no kit roots are touched in that case.
      await wrapped(itemId, foundationalId, skipConfirm);
      if (!item.system.isInstalledInActor) await uninstallPktFrame(item);
      return true;
    }, "MIXED");

  if (CPRActor.prototype.loseHumanityValue) libWrapper.register(MODULE_ID,
    "cprAddendaActorClass.prototype.loseHumanityValue",
    function (wrapped, items, type) {
      const payable = activePktFrame(this) ? items.filter(i => humanityPenalty(i, this) > 0) : items;
      return wrapped(payable, type);
    }, "MIXED");

  // 2. Лист «шестёрки» ставит брошенную на него кибернетику сам, не спрашивая.
  //    Для корпуса ПКТ это гонка: система открывает своё окно установки и
  //    списывает человечность, пока рядом открыт наш мастер, а если её окно
  //    закрыть — она удаляет предмет вместе со всем содержимым. Мастер видел
  //    это своими глазами: человечность ушла, корпус исчез, имплантов нет.
  //    Корпус с комплектом система не трогает — им занимается мастер установки.
  if (CPRActor.prototype.handleMookDraggedItem) {
    libWrapper.register(
      MODULE_ID,
      "cprAddendaActorClass.prototype.handleMookDraggedItem",
      async function cprAddendaMookDrop(wrapped, item) {
        // Сам корпус: им занимается мастер установки.
        if (getKit(item)) return item;
        // Импланты комплекта: их создаёт `deployKit`, и создание на листе
        // «шестёрки» тоже считается «броском предмета». Без этой проверки
        // система откроет своё окно установки на каждый из двух десятков
        // имплантов и за каждый спишет человечность отдельно.
        if (item?.flags?.[MODULE_ID]?.[FLAGS.pktPart]) return item;
        return wrapped(item);
      },
      "MIXED"
    );
  }

  // 3. Максимум человечности: возвращаем штрафы за импланты комплекта.
  libWrapper.register(
    MODULE_ID,
    "cprAddendaActorClass.prototype._calcMaxHumanity",
    function cprAddendaMaxHumanity(wrapped, ...args) {
      return refundKitHumanity(wrapped(...args), this);
    },
    "MIXED"
  );

  // 4. ЭМП у НИП. Система выводит его из человечности при каждой установке
  //    кибернетики:
  //
  //      "system.stats.emp.value": Math.floor(humanity.value / 10)
  //
  //    а саму человечность считает от `stats.emp.max`. На листе «шестёрки»
  //    редактируется только `emp.value`; `emp.max` там показать негде, и он
  //    остаётся стандартной шестёркой. Поэтому первая же установка любого
  //    импланта затирает набранный мастером ЭМП значением из человечности —
  //    у непися с ЭМП 4 он становится 6, а после удаления импланта уезжает
  //    ещё раз. Мастер видел это на «БИОСИСТЕМЕ», но виноват не имплант:
  //    так ведёт себя любая кибернетика.
  //
  //    Cyberpunk RED человечность у НИП не отслеживает — система пишет об этом
  //    прямо в комментарии к `loseHumanityValue`. Значит, и выводить из неё
  //    ЭМП у них незачем: возвращаем то, что поставил мастер.
  //
  //    Правим только настоящих «шестёрок» (`type === "mook"`): лист НИП можно
  //    открыть и у обычного персонажа, а у того человечность считается всерьёз.
  if (CPRActor.prototype.setMaxHumanity) {
    libWrapper.register(
      MODULE_ID,
      "cprAddendaActorClass.prototype.setMaxHumanity",
      async function cprAddendaKeepMookEmpathy(wrapped, ...args) {
        if (this.type !== "mook" || !game.settings.get(MODULE_ID, SETTINGS.mookEmpathy)) {
          return wrapped(...args);
        }
        const before = this.system?.stats?.emp?.value;
        const result = await wrapped(...args);
        const after = this.system?.stats?.emp?.value;
        if (Number.isInteger(before) && after !== before) {
          await this.update({ "system.stats.emp.value": before });
        }
        return result;
      },
      "MIXED"
    );
  }

  console.log(`${MODULE_ID} | Комплекты корпусов ПКТ подключены`);
}

/** Rules shared by the FBC installer and the real system document mixins. */
import { MODULE_ID } from "./constants.js";

const flag = (item, key) => item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
export const isPktFrame = item => Boolean(flag(item, "pktKit"));
export const activePktFrame = actor => actor?.items?.find(i => isPktFrame(i) && i.system?.isInstalledInActor);
export const installedBiosystem = actor => actor?.items?.find(i => borgRule(i).kind === "biosystem" && i.system?.isInstalledInActor);
const installed = actor => actor?.items?.filter(i => i.type === "cyberware" && i.system?.isInstalledInActor) ?? [];

/** Metadata first; name fallback keeps original system compendiums compatible. */
export function borgRule(item) {
  const explicit = flag(item, "borgRule");
  if (explicit) return explicit;
  const name = String(item?.name ?? "").toLowerCase();
  if (/биосистем|biosystem/.test(name)) return { kind: "biosystem", maxHumanityLoss: 4 };
  if (/grafted.*muscle|искусственн.*мышц|усилен.*мышц/.test(name)) return { kind: "graftedMuscle" };
  if (/эндоскелет|implanted.*frame|internal.*frame/.test(name)) {
    const omega = /омега|omega|ω/.test(name), beta = /бета|beta|β/.test(name);
    const advanced = /swat|f[uū]ma|vermilion|котар|вермилион/.test(name);
    return { kind: "internalFrame", body: omega ? 16 : beta ? 14 : 12,
      minimumBody: omega ? 10 : beta || advanced ? 8 : 6, muscleCount: omega ? 3 : beta || advanced ? 2 : 1,
      maxHumanityLoss: omega ? 8 : 4 };
  }
  if (/external.*frame|внешний.*экзоскелет/.test(name)) return { kind: "externalFrame" };
  if (/тяж[её]лая подкожная броня|heavy subdermal armor/.test(name)) return { kind: "heavyArmor", minimumBody: 10, maxHumanityLoss: 4 };
  if (/броня драгуна|dragoon.*plating|защитное покрытие драгун/.test(name)) return { kind: "dragoonArmor", minimumBody: 16, maxHumanityLoss: 4 };
  if (/подкожная броня|subdermal armor/.test(name)) return { kind: "cyberArmor", armor: { sp: 11, penalty: 0 } };
  if (/skinweave|fleshweave|вплетение в (?:плоть|кожу)/.test(name)) return { kind: "cyberArmor", armor: { sp: 7, penalty: 0 } };
  if (/h[uú]safell|х[уү]сафел/.test(name)) return { kind: "externalFrame", muscleMantle: true };
  return {};
}

export function kitPartTemplate(item) {
  const part = flag(item, "pktPart");
  if (!part) return undefined;
  const kit = flag(item.parent?.items?.get(part.frame), "pktKit");
  return [...(kit?.foundations ?? []).flatMap(g => [g.item, ...(g.options ?? [])]), ...(kit?.carried ?? [])][part.slot];
}

function basePenalty(item) {
  return item.system?.type === "borgware" ? 4 : Number(item.system?.humanityLoss?.static) > 0 ? 2 : 0;
}

export function isFreePktFoundation(item) {
  return ["internalFrame", "cyberskull"].includes(borgRule(item).kind) ||
    (item.system?.isFoundational && !item.system?.core &&
      ["cyberArm", "cyberLeg", "cyberEye", "cyberAudioSuite", "neuralWare"].includes(item.system.type));
}

export function humanityPenalty(item, actor) {
  if (isPktFrame(item)) return 0; // The package is not an additional implant.
  const template = kitPartTemplate(item);
  const declared = flag(item, "pktMaxHumanityLoss") ?? flag(template, "pktMaxHumanityLoss");
  if (declared !== undefined) return Number(declared);
  const group = flag(item, "pktGroup") ?? flag(template, "pktGroup");
  if (group === "free") return 0;
  if (group === "cost") return borgRule(item).maxHumanityLoss ?? (item.system.type === "borgware" ? 4 : 2);
  if (activePktFrame(actor) && isFreePktFoundation(item)) return 0;
  return borgRule(item).maxHumanityLoss ?? basePenalty(item);
}

export function correctMaxHumanity(base, actor) {
  return base + installed(actor).reduce((sum, item) => sum + basePenalty(item) - humanityPenalty(item, actor), 0);
}

/** BODY prerequisites are checked before a frame's own BODY effect applies. */
export function checkBorgPrerequisites(actor, item) {
  if (!actor || item?.type !== "cyberware") return { ok: true };
  if (actor.type && !["character", "mook"].includes(actor.type)) return { ok: true };
  const rule = borgRule(item), fbc = activePktFrame(actor);
  if (isPktFrame(item) && !installedBiosystem(actor)) return { ok: false, reason: "Для корпуса ПКТ требуется установленная Биосистема." };
  if (rule.kind === "biosystem" && installed(actor).some(i => i.id !== item.id && borgRule(i).kind === "biosystem"))
    return { ok: false, reason: "Биосистема уже установлена." };
  if (flag(item, "pktPart")) return { ok: true }; // package deployment precedes body activation
  if (installedBiosystem(actor) && !fbc && !isPktFrame(item) && rule.kind !== "biosystem" && !item.system.core)
    return { ok: false, reason: "Биосистема вне корпуса ПКТ не может использовать дополнительные киберимпланты." };
  if (rule.fbcOnly && !fbc) return { ok: false, reason: "Этот имплант устанавливается только в корпус ПКТ." };
  if (rule.kind === "internalFrame" && installed(actor).some(i => i.id !== item.id && borgRule(i).kind === "internalFrame"))
    return { ok: false, reason: "Можно установить только один внутренний эндоскелет." };
  if (rule.requiresInternalFrame && !installed(actor).some(i => borgRule(i).kind === "internalFrame"))
    return { ok: false, reason: "Требуется установленный внутренний эндоскелет." };
  const body = Number(actor.system?.stats?.body?.value) || 0;
  if (rule.maximumBody && body > rule.maximumBody) return { ok: false, reason: `Имплант несовместим с ТЕЛ выше ${rule.maximumBody}.` };
  if (fbc) return { ok: true };
  const muscles = installed(actor).filter(i => borgRule(i).kind === "graftedMuscle").length;
  if (rule.minimumBody && body < rule.minimumBody) return { ok: false, reason: `Для установки требуется ТЕЛ ${rule.minimumBody}.` };
  if (rule.muscleCount && muscles < rule.muscleCount) return { ok: false, reason: `Требуется установок искусственных мышц и усиленных костей: ${rule.muscleCount}.` };
  return { ok: true };
}

/** Doubled base slots remain derived: uninstalling/reinstalling cannot multiply them. */
export function applyBorgItemRules(item) {
  if (item.type === "armor" && flag(item, "borgArmorSource")) {
    const source = (item.actor ?? item.parent)?.items?.get(flag(item, "borgArmorSource"));
    const actor = item.actor ?? item.parent;
    if (!source?.system?.isInstalledInActor) item.system.equipped = "carried";
    const rule = borgRule(source);
    if (rule.kind === "heavyArmor") item.system.penalty = activePktFrame(actor) || Number(actor.system.stats.body.value) >= 14 ? 0 : -2;
    return;
  }
  if (item.type !== "cyberware") return;
  if (item.availableInstallSlots) {
    const original = item.availableInstallSlots;
    item.availableInstallSlots = function (...args) {
      const actor = this.actor ?? this.parent;
      const fbc = activePktFrame(actor);
      const kitHost = flag(this, "pktPart") && this.system?.isFoundational;
      const corePool = this.system?.core && ["cyberwareInternal", "cyberwareExternal", "fashionware"].includes(this.system.type);
      const doubledPool = corePool && this.system.type !== "fashionware";
      let slots = original.apply(this, args);
      if ((kitHost || doubledPool) && (fbc || flag(this, "pktPart"))) slots += Number(this.system.installedItems.slots) || 0;
      // Legacy kits keep body options in the package instead of the core pool.
      if (fbc && corePool) slots -= installed(actor).filter(i => i.id !== this.id && !i.system.core &&
        i.system.type === this.system.type && !this.system.installedItems.list.includes(i.id))
        .reduce((sum, i) => sum + (Number(i.system.size) || 0), 0);
      return slots;
    };
  }
  if (item.canInstallItems) {
    const original = item.canInstallItems;
    item.canInstallItems = function (items) {
      const actor = this.actor ?? this.parent;
      for (const candidate of items ?? []) {
        const result = checkBorgPrerequisites(actor, candidate);
        if (!result.ok) { ui.notifications.warn(result.reason); return false; }
      }
      return original.call(this, items);
    };
  }
}

/** Called after each actor loadMixins, because the system replaces instance methods. */
export function applyBorgActorRules(actor) {
  const original = actor.canInstallItems;
  if (original) actor.canInstallItems = function (items) {
    for (const item of items ?? []) {
      const result = checkBorgPrerequisites(this, item);
      if (!result.ok) { ui.notifications.warn(result.reason); return false; }
    }
    return original.call(this, items);
  };
  const install = actor.installItems;
  if (install) actor.installItems = async function (items) {
    const bio = items?.find(i => borgRule(i).kind === "biosystem" && !i.system.isInstalledInActor);
    const oldRoots = bio ? this.items.filter(i => i.id !== bio.id && i.type === "cyberware" && !i.system.core &&
      this.system.installedItems.list.includes(i.id)) : [];
    const oldCore = bio ? this.items.filter(i => i.type === "cyberware" && i.system.core && i.getInstalledItems).map(host => ({ host,
      items: host.getInstalledItems().filter(i => i.type === "cyberware") })) : [];
    const result = await install.call(this, items);
    if (result && bio) {
      if (oldRoots.length) await this.uninstallItems(oldRoots, { recursive: false, unloadAmmo: false });
      for (const { host, items: children } of oldCore) if (children.length) await host.uninstallItems(children, { recursive: false, unloadAmmo: false });
    }
    return result;
  };
  for (const armor of actor.items.filter(i => i.type === "armor" && flag(i, "borgArmorSource"))) applyBorgItemRules(armor);
}

/** Materialize native Armor documents so the system's SP/damage code sees cyberarmor. */
export async function syncBorgArmor(actor) {
  const linked = actor.items.filter(i => i.type === "armor" && flag(i, "borgArmorSource"));
  for (const source of installed(actor)) {
    const armor = borgRule(source).armor;
    if (!armor || linked.some(i => flag(i, "borgArmorSource") === source.id)) continue;
    await actor.createEmbeddedDocuments("Item", [{ name: `${source.name} (броня)`, type: "armor", img: source.img,
      flags: { [MODULE_ID]: { borgArmorSource: source.id } },
      system: { equipped: "equipped", usage: "equipped", isHeadLocation: true, isBodyLocation: true, isShield: false,
        headLocation: { sp: armor.sp, ablation: 0 }, bodyLocation: { sp: armor.sp, ablation: 0 },
        penalty: -Math.abs(armor.penalty ?? 0), price: { market: 0 },
        description: { value: `<p>Броня киберимпланта «${source.name}». ОС учитывается, пока имплант установлен.</p>` } }
    }], { createInstalled: false, CPRsplitStack: true });
  }
  const orphaned = linked.filter(i => !actor.items.has(flag(i, "borgArmorSource"))).map(i => i.id);
  if (orphaned.length) await actor.deleteEmbeddedDocuments("Item", orphaned, { cprIsMigrating: true });
}

/** External frames increase strength, but never HP or the Death Save. */
export function biologicalBody(actor) {
  const internal = installed(actor).filter(i => borgRule(i).kind === "internalFrame");
  if (internal.length) return Math.max(...internal.map(i => borgRule(i).body));
  const base = Number(actor._source?.system?.stats?.body?.value ?? actor.system.stats.body.value);
  const muscles = installed(actor).filter(i => borgRule(i).kind === "graftedMuscle").length;
  return muscles ? Math.min(10, base + 2 * muscles) : base;
}

/** The Biosystem is immune itself; it does not harden its container or siblings.
 * Present a read-only candidate view to the core EMP listing API. Keep get()
 * intact so the core can still inspect every child's actual hardening property.
 */
export function borgEmpCandidates(actor) {
  if (!actor?.items?.some(i => borgRule(i).kind === "biosystem")) return actor;
  const items = actor.items;
  const view = Object.create(actor);
  Object.defineProperty(view, "items", { value: {
    get: id => items.get(id),
    reduce: (callback, initial) => items.reduce((acc, item, index) => {
      if (borgRule(item).kind !== "biosystem") return callback(acc, item, index);
      const candidate = Object.create(item);
      Object.defineProperty(candidate, "system", { value: { ...item.system, isElectronic: false } });
      return callback(acc, candidate, index);
    }, initial)
  } });
  return view;
}

export function registerBorgActorPatches(CPRActor) {
  if (game.cpr?.api?.actor?.getEMPableItems) libWrapper.register(MODULE_ID,
    "game.cpr.api.actor.getEMPableItems", (wrapped, actor, ...args) => wrapped(borgEmpCandidates(actor), ...args), "MIXED");
  const register = (method, callback) => {
    if (CPRActor.prototype[method]) libWrapper.register(MODULE_ID,
      `cprAddendaActorClass.prototype.${method}`, callback, "MIXED");
  };
  register("loadMixins", function (wrapped, ...args) { const result = wrapped(...args); applyBorgActorRules(this); return result; });
  register("applyActiveEffects", function (wrapped, ...args) {
    const result = wrapped(...args);
    const internal = installed(this).filter(i => borgRule(i).kind === "internalFrame");
    const external = this.items.filter(i => borgRule(i).kind === "externalFrame" && i.system.equipped === "equipped");
    if (internal.length) this.system.stats.body.value = Math.min(this.system.stats.body.value, Math.max(...internal.map(i => borgRule(i).body)));
    else if (!external.some(i => !borgRule(i).muscleMantle) &&
      (installed(this).some(i => borgRule(i).kind === "graftedMuscle") || external.some(i => borgRule(i).muscleMantle)))
      this.system.stats.body.value = Math.min(10, this.system.stats.body.value);
    return result;
  });
  register("getWoundStateMods", function (wrapped, ...args) { return activePktFrame(this) ? 0 : wrapped(...args); });
  register("calcMaxHp", function (wrapped, ...args) {
    const external = this.items.some(i => borgRule(i).kind === "externalFrame" && i.system.equipped === "equipped");
    if (!external) return wrapped(...args);
    return 10 + 5 * Math.ceil((this.system.stats.will.value + biologicalBody(this)) / 2) + (this.bonuses.maxHp || 0);
  });
  register("_createDeathSaveRoll", function (wrapped, ...args) {
    const roll = wrapped(...args);
    if (this.items.some(i => borgRule(i).kind === "externalFrame" && i.system.equipped === "equipped")) roll.bodyStat = biologicalBody(this);
    return roll;
  });
  register("processDeathSave", function (wrapped, roll, ...args) {
    if (!this.items.some(i => borgRule(i).kind === "externalFrame" && i.system.equipped === "equipped")) return wrapped(roll, ...args);
    const before = this.system.stats.body.value;
    this.system.stats.body.value = biologicalBody(this);
    try { return wrapped(roll, ...args); } finally { this.system.stats.body.value = before; }
  });
}

import { MODULE_ID, SYSTEM_ID } from "./constants.js";
import { normalizeCarrierChanges } from "./carrier-data.js";
import { catalogueIdentity } from './catalogue-rules.js';

// A barrel changes the single-shot table, not the weapon's Autofire family.
const AUTO_TABLES = {
  "Укороченный пистолет": "Пистолет (стандартный) (Autofire)",
  "Пистолет (стандартный)": "Пистолет (стандартный) (Autofire)",
  "Удлинённый пистолет": "Пистолет (стандартный) (Autofire)",
  "DV Pistol": "Пистолет (стандартный) (Autofire)",
  "DV Long-Barrel Pistol": "Пистолет (стандартный) (Autofire)",
  "СЛ Пистолет": "Пистолет (стандартный) (Autofire)",
  "Субкомпактный ПП": "Пистолет-пулемёт (Autofire)",
  "Пистолет-пулемёт": "Пистолет-пулемёт (Autofire)",
  "DV SMG": "DV SMG (Autofire)",
  "СЛ ПП": "СЛ ПП (Автоогонь)",
  "Укороченный дробовик": "Пистолет (стандартный) (Autofire)",
  "Дробовик (стандартный)": "Пистолет (стандартный) (Autofire)",
  "Удлинённый дробовик": "Пистолет (стандартный) (Autofire)",
  "DV Shotgun (Slug)": "Пистолет (стандартный) (Autofire)",
  "СЛ Дробовик (Жакан)": "Пистолет (стандартный) (Autofire)",
  "Карабин": "Штурмовая винтовка (Autofire)",
  "Штурмовая винтовка": "Штурмовая винтовка (Autofire)",
  "Боевая винтовка": "Штурмовая винтовка (Autofire)",
  "Марксманская винтовка": "Штурмовая винтовка (Autofire)",
  "DV Assault Rifle": "DV Assault Rifle (Autofire)",
  "СЛ Штурмовая винтовка": "СЛ Штурмовая винтовка (Автоогонь)",
};

export function addendaFlag(item, key) {
  return item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
}

/** Recognize old imports as well as newly flagged compendium entries. */
export function weaponRule(item) {
  const explicit = addendaFlag(item, "weaponRule");
  if (explicit) return explicit;
  const source = item?.flags?.core?.sourceId ?? item?._stats?.compendiumSource ?? "";
  const id = /cpr-addenda\.addenda-weapons\.(?:Item\.)?(\w+)$/.exec(source)?.[1] ?? item?.id ?? item?._id;
  if (id === "cprAddWp00050000" || /MetaCorp.*Victoria/i.test(item?.name ?? "")) return "victoria";
  if (id === "cprAddWp00060000" || /Militech MK\.27/i.test(item?.name ?? "")) return "mk27";
  if (id === "cprAddWp00020000" || /Arasaka Neo Rapid (?:Assault )?16/i.test(item?.name ?? "")) return "neoRapid16";
  if (id === "cprAddWp00080000" || /Tsunami Arms.*Deathwind/i.test(item?.name ?? "")) return "deathwind";
  return null;
}

export function installedWeaponUpgrades(item) {
  return item?.getInstalledItems?.("itemUpgrade") ?? [];
}

export function weaponUpgradeFamily(upgrade) {
  if (normalizeCarrierChanges(addendaFlag(upgrade, "carrierChanges"))["system.dvTable"]) return "rangeProfile";
  const rule = addendaFlag(upgrade, "weaponRule");
  if (["pistolAutosear", "shotgunAutoControl"].includes(rule)) return rule;
  if (upgrade?.name === "Автоспуск пистолета") return "pistolAutosear";
  if (upgrade?.name === "Узел автоматического управления огнём") return "shotgunAutoControl";
  if (upgrade?.name === "Внутренний циклический механизм ПП") return "smgCyclic";
  return null;
}

export function hasShotgunAutoControl(item) {
  if (weaponRule(item) === "neoRapid16") return true;
  return installedWeaponUpgrades(item).some((upgrade) =>
    addendaFlag(upgrade, "weaponRule") === "shotgunAutoControl" ||
    upgrade.name === "Узел автоматического управления огнём"
  );
}

export function isAttackItem(item) {
  return item?.type === 'weapon' || (item?.type === 'cyberware' && item.system.isWeapon) ||
    (item?.type === 'itemUpgrade' && item.system.modifiers?.secondaryWeapon?.configured);
}
export function isShotAttack(item) {
  if (!isAttackItem(item)) return false;
  if (['Flamethrower','Dragon Flamethrower','Burst Flamethrower','Crusher','Aegis','Nomad Air Cannon'].includes(catalogueIdentity(item))) return true;
  let variety;
  try { variety = item._getLoadedAmmoProp?.("variety"); } catch { /* No loaded ammo. */ }
  if (variety) return variety === "shotgunShell";
  const selected = item.actor?.getFlag?.(MODULE_ID, `shotmode-${item.id ?? item._id}`);
  return Boolean(selected);
}

/** Shotgun shells keep ordinary shell damage even with an automatic control group. */
export function getAttackRules(item, fireMode) {
  if (!isShotAttack(item)) return {};
  const automaticShot = fireMode === "autofire" && hasShotgunAutoControl(item);
  if (fireMode === "autofire" && !automaticShot) return {};
  return { shot: true, automaticShot, evasionModifier: automaticShot ? -3 : 0,
    autofireMultiplier: false, damageType: "attack", ammoConsumption: automaticShot ? 4 : 1,
    dv: 13, maxRange: 6 };
}

/** The same resolver is used by the ruler, vehicle sheet and other modules. */
export function resolveDvTable(item, fireMode, baseTable = item?.system?.dvTable) {
  const base = typeof baseTable === "string" ? baseTable.trim() : baseTable?.name ?? "";
  if (fireMode !== "autofire") return base;
  const upgradeTable = installedWeaponUpgrades(item)
    .map((upgrade) => addendaFlag(upgrade, "autofireDvTable")).find(Boolean);
  const explicit = upgradeTable ?? addendaFlag(item, "autofireDvTable");
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (["victoria", "mk27"].includes(weaponRule(item))) return "Пулемёт (Autofire)";
  if (hasShotgunAutoControl(item)) return "Пистолет (стандартный) (Autofire)";
  if (/\((?:Autofire|Автоогонь)\)$/i.test(base)) return base;
  if (!base) return "";
  return AUTO_TABLES[base] ?? `${base} (Autofire)`;
}

export async function setWeaponDvTable(item, actor, baseTable = item?.system?.dvTable, token = actor?.sheet?.token) {
  const tokenObject = token?.object ?? (token?.document ? token : null);
  if (!tokenObject) return;
  const mode = actor?.getFlag?.(SYSTEM_ID, `firetype-${item.id ?? item._id}`) ??
    actor?.flags?.[SYSTEM_ID]?.[`firetype-${item.id ?? item._id}`];
  const rules = getAttackRules(item, mode ?? "attack");
  if (rules.shot) {
    await tokenObject.document.unsetFlag(SYSTEM_ID, "cprDvTable");
    return tokenObject.document.setFlag(SYSTEM_ID, "cprDvTable", {
      name: game.i18n.localize("CPRADDENDA.shot.short"), table: { "0_6": "13" },
    });
  }
  const { default: utils } = await import(`/systems/${SYSTEM_ID}/modules/utils/cpr-systemUtils.js`);
  return utils.SetDvTable(tokenObject, resolveDvTable(item, mode, baseTable));
}

/** Update the actor first, then rebuild the actual system token flag (name + rows). */
export async function toggleWeaponFireMode(sheet, weaponId, fireMode) {
  const item = sheet.actor.items.get(weaponId);
  if (!item) return;
  const previous = sheet.actor.getFlag(SYSTEM_ID, `firetype-${weaponId}`);
  if (previous === fireMode) await sheet.actor.unsetFlag(SYSTEM_ID, `firetype-${weaponId}`);
  else await sheet.actor.setFlag(SYSTEM_ID, `firetype-${weaponId}`, fireMode);
  const token = sheet.token;
  if (!token) return;
  const selected = token.getFlag?.(SYSTEM_ID, "cprDvTable") ?? token.document?.getFlag?.(SYSTEM_ID, "cprDvTable");
  const base = item.system.dvTable || selected?.name || "";
  // When the item has no own table, a ruler-selected Autofire table can be
  // converted back to the base table on leaving Autofire.
  const table = !item.system.dvTable && previous === "autofire"
    ? base.replace(/ \((?:Autofire|Автоогонь)\)$/i, "") : base;
  await setWeaponDvTable(item, sheet.actor, table, token);
}

export async function registerSystemDvPatch() {
  try {
    const { default: Sheet } = await import(`/systems/${SYSTEM_ID}/modules/actor/sheet/cpr-actor-sheet.js`);
    globalThis.cprAddendaActorSheetClass = Sheet;
    libWrapper.register(MODULE_ID, "cprAddendaActorSheetClass.prototype._fireCheckboxToggle",
      async function (_wrapped, event) {
        const element = event.currentTarget?.closest?.("[data-item-id]") ?? event.currentTarget;
        const weaponId = element?.dataset?.itemId;
        const fireMode = element?.dataset?.fireMode;
        if (!weaponId || !fireMode) return _wrapped(event);
        return toggleWeaponFireMode(this, weaponId, fireMode);
      }, "MIXED");
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось исправить переключение таблицы дальности`, error);
  }
}

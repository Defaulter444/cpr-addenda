import { MODULE_ID, VAS_MODULE_ID } from "./constants.js";
import { hasAddendaVehicleData, reconcileEffectsAfterPending } from "./vehicle-effects.js";

let registered = false;

/** Keep the original VAS usable while Addenda owns migrated vehicle effects. */
export function registerVasCompatibility() {
  if (!game.modules.get(VAS_MODULE_ID)?.active) return true;
  if (registered) return true;
  try {
    // At ready every sheet has already been registered. Resolving it here is
    // synchronous, so the old module's ready hook cannot start first while an
    // optional module import is pending.
    const key = `${VAS_MODULE_ID}.VehicleSheet`;
    const sheets = Object.values(CONFIG.Actor.sheetClasses ?? {});
    const legacy = sheets.map(types => types[key]?.cls).find(Boolean);
    if (typeof legacy?.reconcileEffects !== "function") return false;
    globalThis.cprAddendaLegacyVehicleSheet = legacy;
    libWrapper.register(MODULE_ID, "cprAddendaLegacyVehicleSheet.reconcileEffects",
      async function (wrapped, actor, ...args) {
        if (hasAddendaVehicleData(actor)) return reconcileEffectsAfterPending(actor);
        const result = await wrapped(actor, ...args);
        // Migration can claim this vehicle while the old asynchronous CRUD is
        // in flight. Clean its final legacy output after that call settles.
        if (hasAddendaVehicleData(actor)) await reconcileEffectsAfterPending(actor);
        return result;
      }, "MIXED");
    registered = true;
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось подключить совместимость эффектов VAS`, error);
    return false;
  }
}

/** Also cover VAS calls that began before this module registered its wrapper. */
export async function waitForLegacyVehicleEffects(actor) {
  const locks = globalThis.cprAddendaLegacyVehicleSheet?._reconcileEffectsLocks;
  const deadline = Date.now() + 30000;
  while (locks?.has(actor.id)) {
    if (Date.now() >= deadline) throw new Error(`VAS effect reconciliation did not settle for ${actor.id}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

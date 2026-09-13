/** Public helpers. Each area is persisted on its own chat message. */
export { BLAST, SHOT, areaKindOf, areaGeometry, inBlast, snapToGrid, snapshotAreaAttack } from './area-rules.js';
export { activateAreaCard, sightBlocked, tokenOf } from './area-workflow.js';
export const BLAST_SQUARES = 5, SHOT_SQUARES = 3, SHOT_FLAG = 'shotmode', DODGE_REF = 8;
export function loadedVariety(item) { try { return item?._getLoadedAmmoProp?.('variety'); } catch { return undefined; } }
export function canFireShot(item) { return item?.type === 'weapon' && item.system.weaponType === 'shotgun'; }
export function shotModeOn(item) { return Boolean(item?.actor?.getFlag('cpr-addenda', `shotmode-${item.id}`)); }

import { ID, areaKindOf, SHOT } from './area-rules.js';
import { throwGrenade } from './area-workflow.js';
/** Loading real shells enables the area mode. A flag cannot turn loaded slugs into shells. */
export function registerShotMode() {
  Hooks.on('renderActorSheet', (app, html) => {
    if (!game.settings.get(ID, 'explosiveTemplates') || !app.actor?.isOwner) return;
    const root = html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    for (const row of root.querySelectorAll('[data-item-id]')) {
      const item = app.actor.items.get(row.dataset.itemId);
      if (!item || row.querySelector('[data-addenda-area-item]') || row.parentElement?.closest('[data-item-id]')) continue;
      if (item.type === 'ammo' && item.system.variety === 'grenade') {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.addendaAreaItem = item.id;
        button.className = 'cpr-addenda-throw-grenade'; button.textContent = 'Бросить гранату';
        button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); throwGrenade(item, e).catch(error => ui.notifications.error(error.message)); });
        row.append(button);
      } else if (item.type === 'weapon' && item.system.weaponType === 'shotgun') {
        const label = document.createElement('small'); label.dataset.addendaAreaItem = item.id;
        label.className = 'cpr-addenda-shell-info';
        label.textContent = areaKindOf(item) === SHOT ? 'Дробь · СЛ 13 · 3d6 · зона 6 × 6 м' : 'Для площадного выстрела зарядите дробь';
        row.append(label);
      }
    }
  });
}

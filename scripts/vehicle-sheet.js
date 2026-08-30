/**
 * Лист транспорта.
 *
 * Перенесён из модуля MMuton's CPR Vehicle Actor Sheet с разрешения автора и
 * переведён на русский. Оригинал: https://github.com/MMuton/MMutons-Cyberpunk-Vehicle-Actor-Sheet
 *
 * Что это такое. В Cyberpunk RED транспорт — предмет, а не действующее лицо: у
 * него нет ни своего листа, ни экипажа, ни возможности стрелять. Этот лист
 * подменяет актёру вид и превращает его в машину с постами: у каждого поста
 * своё название, свои места, свои навыки и своё оружие. Кто сядет на пост —
 * получит права на транспорт, модификаторы характеристик и возможность
 * стрелять из закреплённого за постом ствола своим навыком.
 *
 * Название обманчиво: пост — это любая обслуживаемая точка, поэтому лист
 * одинаково годится для машины, турели, силовой брони и шагохода.
 *
 * Устройство. Своего типа актёра модуль не заводит — лист вешается на обычных
 * `character` и `mook`, потому что система умеет считать их характеристики,
 * броню и раны, а транспорту всё это и нужно. Данные постов лежат во флаге
 * актёра, привязка оружия и модификаций — во флагах самих предметов.
 *
 * Права доступа и активные эффекты живут не здесь, а в `vehicle-effects.js`:
 * они должны работать и при закрытом листе.
 */

import { MODULE_ID, SYSTEM_ID, VEHICLE_FLAGS, localize } from "./constants.js";
import { objectTypeLabel } from "./cpr-config.js";
import {
  reconcilePermissions,
  reconcileEffects,
} from "./vehicle-effects.js";
import { findSkill, skillNamesHint } from "./vehicle-skills.js";

/**
 * Утилиты системы. Нужны ровно в одном месте — за списком таблиц дальности при
 * переключении на стрельбу очередью.
 *
 * Импорт отложенный и в try. Статический импорт из системы намертво связал бы
 * загрузку всего модуля с этим файлом: переедет он в следующей версии системы —
 * и `cpr-addenda` не загрузится целиком, вместе с компендиумами. Так же
 * подстрахован справочник конфига в `cpr-config.js`.
 *
 * @returns {Promise<Object|null>}
 */
async function systemUtils() {
  try {
    const mod = await import(
      `/systems/${SYSTEM_ID}/modules/utils/cpr-systemUtils.js`
    );
    return mod.default ?? null;
  } catch (error) {
    console.warn(
      `${MODULE_ID} | утилиты системы недоступны, таблица дальности при очереди не переключится.`,
      error
    );
    return null;
  }
}

/** Экранирование того, что попадает в HTML диалогов. */
const esc = (value) => Handlebars.escapeExpression(String(value ?? ""));

/** Сутки в миллисекундах: срок, после которого права пересверяются сами. */
const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000;

export class VehicleSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      // Класс `vas-vehicle` оставлен от оригинала: на нём держится вся
      // таблица стилей, и переименование стоило бы правки 38 КБ CSS без
      // единой выгоды.
      classes: ["cyberpunk-red", "sheet", "actor", "vas-vehicle"],
      template: `modules/${MODULE_ID}/templates/vehicle-sheet.hbs`,
      width: 820,
      height: 750,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "main",
        },
      ],
      dragDrop: [{ dragSelector: ".item-list .item", dropSelector: null }],
    });
  }

  /**
   * Раз в сутки при открытии листа права и эффекты сверяются заново.
   *
   * Нужно потому, что мир меняется и мимо листа: игроку выдали персонажа,
   * мастер поправил владельца, кто-то удалил токен. Отметка времени хранится
   * на актёре, чтобы сверка не запускалась при каждом открытии.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);
    if (!game.user.isGM) return;

    const syncedAt = this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.synced);
    if (syncedAt && Date.now() - syncedAt <= RESYNC_AFTER_MS) return;

    const positions = this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || [];
    if (positions.length === 0) return;

    await reconcilePermissions(this.actor);
    await reconcileEffects(this.actor);
    await this.actor.setFlag(MODULE_ID, VEHICLE_FLAGS.synced, Date.now());
  }

  async getData(options) {
    const context = await super.getData(options);

    if (!this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions)) {
      await this.actor.setFlag(MODULE_ID, VEHICLE_FLAGS.positions, []);
    }

    context.positions = await this._preparePositions();
    context.weapons = this.actor.items.filter((item) => item.type === "weapon");
    context.armor = this.actor.items.filter((item) => item.type === "armor");
    context.cargoByCategory = this._sortCargoByCategory(this._cargoItems());
    context.mountedUpgrades = this._prepareMountedUpgrades();
    context.criticalInjuries = this.actor.items.filter(
      (item) => item.type === "criticalInjury"
    );

    const info = this.actor.system.information || {};
    context.information = info;
    context.enrichedDescription = await TextEditor.enrichHTML(
      info.description || "",
      { async: true }
    );
    context.enrichedNotes = await TextEditor.enrichHTML(info.notes || "", {
      async: true,
    });
    context.isOwner = this.actor.isOwner;
    context.editable = this.isEditable;

    return context;
  }

  /**
   * Что показывать в грузе.
   *
   * Отсеиваем то, у чего на листе есть своя вкладка, и то, что уже стоит на
   * машине. Отдельная строка — «основа» кибернетики: система заводит на каждом
   * актёре три служебных предмета под слоты расширений, игроку они не нужны.
   *
   * Опознаём их по системному полю `system.core`, а не по названию. Оригинал
   * искал в имени подстроку «Option Slots», и под русским языком это ломалось:
   * Babele переименовывает их во «Внешние (7 слотов расширений)», и все три
   * служебных предмета вываливались в груз.
   *
   * @returns {Array<CPRItem>}
   */
  _cargoItems() {
    const excluded = ["weapon", "armor", "skill", "role", "criticalInjury"];
    return this.actor.items.filter((item) => {
      if (excluded.includes(item.type)) return false;
      if (item.system?.core === true) return false;
      if (
        item.type === "itemUpgrade" &&
        item.getFlag(MODULE_ID, VEHICLE_FLAGS.mounted)
      ) {
        return false;
      }
      if (
        item.type === "cyberware" &&
        item.getFlag(MODULE_ID, VEHICLE_FLAGS.installed)
      ) {
        return false;
      }
      return true;
    });
  }

  /**
   * Разбивает груз по типам предметов.
   *
   * Заголовок группы берём из справочника системы, а не из самого ключа типа:
   * иначе на русском листе стояли бы «Ammo» и «ItemUpgrade».
   *
   * @param {Array<CPRItem>} cargoItems - предметы в грузе
   * @returns {Array<Object>|null}
   */
  _sortCargoByCategory(cargoItems) {
    if (!cargoItems || cargoItems.length === 0) return null;

    const grouped = {};
    for (const item of cargoItems) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item);
    }

    return Object.keys(grouped)
      .map((type) => ({
        categoryName: objectTypeLabel(type),
        items: grouped[type].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }

  _prepareMountedUpgrades() {
    const upgrades = this.actor.items.filter(
      (item) =>
        item.type === "itemUpgrade" &&
        item.getFlag(MODULE_ID, VEHICLE_FLAGS.mounted)
    );
    const cyberware = this.actor.items.filter(
      (item) =>
        item.type === "cyberware" &&
        item.getFlag(MODULE_ID, VEHICLE_FLAGS.installed)
    );

    return [...upgrades, ...cyberware].map((item) => ({
      id: item.id,
      name: item.name,
      img: item.img,
      type: item.type,
      description: item.system.description?.value || item.system.description || "",
    }));
  }

  /**
   * Готовит посты к отрисовке: подтягивает пассажиров по uuid, считает
   * занятость и собирает закреплённое оружие.
   *
   * Пассажира, которого текущий пользователь не имеет права видеть, в список не
   * кладём — иначе игрок прочитает с чужого листа имя и здоровье.
   *
   * @returns {Promise<Array<Object>>}
   */
  async _preparePositions() {
    const positions = this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || [];
    const prepared = [];

    for (const pos of positions) {
      const occupants = (
        await Promise.all(
          (pos.occupants || []).map(async (uuid) => {
            try {
              const actor = await fromUuid(uuid);
              if (!actor?.testUserPermission(game.user, "OBSERVER")) return null;
              return {
                uuid,
                id: actor.id,
                name: actor.name,
                img: actor.img,
                type: actor.type,
                hp: actor.system.derivedStats?.hp?.value || 0,
                hpMax: actor.system.derivedStats?.hp?.max || 0,
              };
            } catch (error) {
              return null;
            }
          })
        )
      ).filter((occupant) => occupant !== null);

      const weapons = this.actor.items.filter(
        (item) =>
          item.type === "weapon" &&
          item.getFlag(MODULE_ID, VEHICLE_FLAGS.mountedPosition) === pos.id
      );
      const maxOccupants = pos.maxOccupants || 1;

      prepared.push({
        ...pos,
        occupants,
        hasOccupants: occupants.length > 0,
        isFull: occupants.length >= maxOccupants,
        isCrammed: occupants.length > maxOccupants,
        weapons,
        hasWeapons: weapons.length > 0,
        skillsList: (pos.skills || "")
          .split(",")
          .map((skill) => skill.trim())
          .filter((skill) => skill),
        bulletproofGlass: pos.bulletproofGlass || false,
        glassHp: pos.glassHp || 0,
        glassHpMax: pos.glassHpMax || 0,
      });
    }

    return prepared.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".item-edit").click(this._onItemEdit.bind(this));
    html.find(".occupant-view").click(this._onOccupantView.bind(this));
    html.find(".select-token").click(this._onSelectToken.bind(this));
    html.find(".weapon-sheet-btn").click(this._onWeaponSheet.bind(this));
    html
      .find('.weapon-action-icon[data-action="changeAmmo"]')
      .click(this._onChangeAmmo.bind(this));
    html
      .find('.weapon-action-icon[data-action="reload"]')
      .click(this._onReload.bind(this));
    html
      .find(".position-weapons-compact .rollable")
      .click(this._onWeaponRoll.bind(this));
    html
      .find(".position-skills .skill-tag.rollable")
      .click(this._onSkillRoll.bind(this));
    html.find(".glass-hp").click(this._onGlassHpClick.bind(this));
    html.find(".upgrade-mount").click(this._onUpgradeMount.bind(this));
    html.find(".upgrade-unmount").click(this._onUpgradeUnmount.bind(this));
    html.find(".upgrade-view").click(this._onItemEdit.bind(this));
    html.find(".cyberware-install").click(this._onCyberwareInstall.bind(this));
    html
      .find(".cyberware-uninstall")
      .click(this._onCyberwareUninstall.bind(this));

    html.find(".occupant-item.draggable").each((i, el) => {
      el.addEventListener("dragstart", this._onOccupantDragStart.bind(this));
    });
    html.find(".drop-zone").each((i, el) => {
      el.addEventListener("dragover", this._onOccupantDragOver.bind(this));
      el.addEventListener("drop", this._onOccupantDrop.bind(this));
    });

    // Поле названия растёт под текст: русские названия длиннее английских,
    // и фиксированная ширина обрезала бы половину.
    const nameInput = html.find(".charname input")[0];
    if (nameInput) {
      const resize = (el) =>
        el.setAttribute(
          "size",
          Math.max(6, (el.value || el.placeholder || "").length)
        );
      resize(nameInput);
      nameInput.addEventListener("input", () => resize(nameInput));
    }

    if (!this.isEditable) return;

    html.find("button.item-create").click(this._onItemCreate.bind(this));
    html.find(".item-delete").click(this._onItemDelete.bind(this));
    html.find("button.position-add").click(this._onPositionAdd.bind(this));
    html.find(".position-edit").click(this._onPositionEdit.bind(this));
    html.find(".position-delete").click(this._onPositionDelete.bind(this));
    html.find(".occupant-remove").click(this._onOccupantRemove.bind(this));
    html.find(".weapon-mount").click(this._onWeaponMount.bind(this));
    html.find(".weapon-unmount").click(this._onWeaponUnmount.bind(this));
    html.find(".armor-equip").click(this._onArmorEquip.bind(this));
    html.find(".fire-checkbox").click(this._onFireCheckboxToggle.bind(this));
    html.find(".item-split").click(this._onItemSplit.bind(this));

    html.find(".item.draggable").each((i, el) => {
      el.addEventListener("dragstart", this._onItemDragStart.bind(this));
      el.addEventListener("dragend", this._onItemDragEnd.bind(this));
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Посты                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Короткая запись: взять посты копией, готовой к правке.
   *
   * Копия обязательна. Массив из флага — тот самый объект, что лежит в актёре;
   * правка на месте не считается изменением, и Foundry её не сохранит.
   *
   * @returns {Array<Object>}
   */
  _positions() {
    return foundry.utils.deepClone(
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
    );
  }

  /**
   * Записать посты обратно на актёра.
   *
   * @param {Array<Object>} positions - новый список постов
   * @returns {Promise<void>}
   */
  async _savePositions(positions) {
    await this.actor.setFlag(MODULE_ID, VEHICLE_FLAGS.positions, positions);
  }

  async _onPositionAdd(event) {
    event.preventDefault();
    event.stopPropagation();

    const positions = this._positions();
    positions.push({
      id: foundry.utils.randomID(),
      name: localize("vehicle.position.default"),
      order: positions.length + 1,
      occupants: [],
      skills: "",
      statMods: "",
      maxOccupants: 1,
      canControlWeapons: false,
      grantsTokenControl: false,
      matchVehicleMove: false,
      matchOccupantMove: false,
    });

    await this._savePositions(positions);
  }

  async _onPositionEdit(event) {
    event.preventDefault();
    const posId = event.currentTarget.dataset.positionId;
    const pos = (
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
    ).find((p) => p.id === posId);
    if (!pos) return;

    const checked = (value) => (value ? "checked" : "");
    const row = (label, field) => `
      <div class="form-group">
        <label>${esc(label)}</label>
        ${field}
      </div>`;
    const toggle = (label, name, value) => `
      <div class="form-group">
        <label>
          <input type="checkbox" name="${name}" ${checked(value)}/>
          ${esc(label)}
        </label>
      </div>`;

    new Dialog({
      title: localize("vehicle.position.editTitle", { position: pos.name }),
      content: `
        <form>
          ${row(
            localize("vehicle.position.name"),
            `<input type="text" name="name" value="${esc(pos.name)}"/>`
          )}
          ${row(
            localize("vehicle.position.order"),
            `<input type="number" name="order" value="${Number(pos.order) || 1}" min="1"/>`
          )}
          ${row(
            localize("vehicle.position.maxOccupants"),
            `<input type="number" name="maxOccupants" value="${Number(pos.maxOccupants) || 1}" min="1"/>`
          )}
          ${toggle(
            localize("vehicle.position.canControlWeapons"),
            "canControlWeapons",
            pos.canControlWeapons
          )}
          <div class="form-group">
            <label>
              <input type="checkbox" name="bulletproofGlass" class="glass-checkbox" ${checked(pos.bulletproofGlass)}/>
              ${esc(localize("vehicle.position.glass"))}
            </label>
          </div>
          <div class="form-group glass-hp-group" style="display: ${pos.bulletproofGlass ? "block" : "none"};">
            <label>${esc(localize("vehicle.position.glassHpMax"))}</label>
            <input type="number" name="glassHpMax" value="${Number(pos.glassHpMax) || 0}" min="0"/>
          </div>
          ${row(
            localize("vehicle.position.skills"),
            `<input type="text" name="skills" value="${esc(pos.skills || "")}" placeholder="${esc(localize("vehicle.position.skillsPlaceholder"))}"/>`
          )}
          ${row(
            localize("vehicle.position.statMods"),
            `<input type="text" name="statMods" value="${esc(pos.statMods || "")}" placeholder="${esc(localize("vehicle.position.statModsPlaceholder"))}"/>`
          )}
          ${toggle(
            localize("vehicle.position.matchVehicleMove"),
            "matchVehicleMove",
            pos.matchVehicleMove
          )}
          ${toggle(
            localize("vehicle.position.matchOccupantMove"),
            "matchOccupantMove",
            pos.matchOccupantMove
          )}
          ${toggle(
            localize("vehicle.position.grantsTokenControl"),
            "grantsTokenControl",
            pos.grantsTokenControl
          )}
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: localize("vehicle.common.save"),
          callback: async (html) => {
            const form = html[0].querySelector("form");
            const data = new FormDataExtended(form).object;

            const positions = this._positions();
            const position = positions.find((p) => p.id === posId);
            if (!position) return;

            position.name = data.name;
            position.order = Number(data.order);
            position.maxOccupants = Number(data.maxOccupants);
            position.canControlWeapons = data.canControlWeapons;
            position.skills = data.skills;
            position.statMods = data.statMods || "";
            position.bulletproofGlass = data.bulletproofGlass;
            position.grantsTokenControl = data.grantsTokenControl;
            position.matchVehicleMove = data.matchVehicleMove || false;
            position.matchOccupantMove = data.matchOccupantMove || false;

            if (data.bulletproofGlass) {
              const newMax = Number(data.glassHpMax);
              position.glassHpMax = newMax;
              // Уже побитое стекло не чинится от того, что мастер поднял
              // предел, но и выше нового предела не остаётся.
              position.glassHp = position.glassHp
                ? Math.min(position.glassHp, newMax)
                : newMax;
            } else {
              position.glassHp = 0;
              position.glassHpMax = 0;
            }

            await this._savePositions(positions);
          },
        },
        cancel: { label: localize("vehicle.common.cancel") },
      },
      default: "save",
      render: (html) => {
        html.find(".glass-checkbox").change((event) => {
          const group = html.find(".glass-hp-group");
          if (event.target.checked) group.show();
          else group.hide();
        });
        // Две «подтяжки» СКО взаимно исключают друг друга: иначе транспорт и
        // пассажир начали бы переписывать скорость друг у друга по кругу.
        html.find('[name="matchVehicleMove"]').change((event) => {
          if (event.target.checked) {
            html.find('[name="matchOccupantMove"]').prop("checked", false);
          }
        });
        html.find('[name="matchOccupantMove"]').change((event) => {
          if (event.target.checked) {
            html.find('[name="matchVehicleMove"]').prop("checked", false);
          }
        });
      },
    }).render(true);
  }

  async _onPositionDelete(event) {
    event.preventDefault();
    const posId = event.currentTarget.dataset.positionId;

    const confirmed = await Dialog.confirm({
      title: localize("vehicle.position.deleteTitle"),
      content: `<p>${esc(localize("vehicle.position.deleteBody"))}</p>`,
    });
    if (!confirmed) return;

    await this._savePositions(
      this._positions().filter((pos) => pos.id !== posId)
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Экипаж                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Сажает актёра на пост, предварительно сняв его со всех остальных.
   *
   * Один человек не может быть в двух местах разом, поэтому чистка идёт по
   * всем постам, а не только по исходному.
   *
   * @param {String} uuid - uuid актёра
   * @param {String} posId - id поста
   * @returns {Promise<Boolean>} - удалось ли посадить
   */
  async _seatOccupant(uuid, posId) {
    const positions = this._positions();
    for (const pos of positions) {
      pos.occupants = (pos.occupants || []).filter((u) => u !== uuid);
    }

    const target = positions.find((pos) => pos.id === posId);
    if (!target) return false;

    if (!target.occupants) target.occupants = [];
    if (target.occupants.length > (target.maxOccupants || 1)) return false;
    target.occupants.push(uuid);

    await this._savePositions(positions);
    await reconcilePermissions(this.actor);
    return true;
  }

  async _onSelectToken(event) {
    event.preventDefault();
    const posId = event.currentTarget.dataset.positionId;
    const controlled = canvas.tokens.controlled;

    if (controlled.length === 0) {
      ui.notifications.warn(localize("vehicle.notify.selectToken"));
      return;
    }
    if (controlled.length > 1) {
      ui.notifications.warn(localize("vehicle.notify.selectOneToken"));
      return;
    }

    const actor = controlled[0].actor;
    if (!actor) return;
    await this._seatOccupant(actor.uuid, posId);
  }

  async _onOccupantRemove(event) {
    event.preventDefault();
    const posId = event.currentTarget.dataset.positionId;
    const occupantUuid = event.currentTarget.dataset.occupantUuid;

    const positions = this._positions();
    const pos = positions.find((p) => p.id === posId);
    if (!pos) return;

    pos.occupants = (pos.occupants || []).filter((u) => u !== occupantUuid);
    await this._savePositions(positions);
    await reconcilePermissions(this.actor);
  }

  _onOccupantView(event) {
    event.preventDefault();
    fromUuid(event.currentTarget.dataset.occupantUuid).then((actor) =>
      actor?.sheet.render(true)
    );
  }

  _onOccupantDragStart(event) {
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({
        type: "occupant",
        uuid: event.currentTarget.dataset.occupantUuid,
        fromPosition: event.currentTarget.dataset.positionId,
      })
    );
  }

  _onOccupantDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add("dragover");
  }

  async _onOccupantDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("dragover");

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (error) {
      return;
    }
    if (!data || data.type !== "occupant") return;

    const toPositionId = event.currentTarget.dataset.positionId;
    if (toPositionId === data.fromPosition) return;

    await this._seatOccupant(data.uuid, toPositionId);
  }

  /* ---------------------------------------------------------------------- */
  /*  Предметы                                                               */
  /* ---------------------------------------------------------------------- */

  _onItemEdit(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  _onWeaponSheet(event) {
    event.preventDefault();
    this.actor.items.get(event.currentTarget.dataset.itemId)?.sheet.render(true);
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    return Item.create(
      {
        name: localize("vehicle.item.new", { type: objectTypeLabel(type) }),
        type,
        system: {},
      },
      { parent: this.actor }
    );
  }

  async _onItemDelete(event) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: localize("vehicle.item.deleteTitle"),
      content: `<p>${esc(localize("vehicle.item.deleteBody", { name: item.name }))}</p>`,
    });
    if (confirmed) await item.delete();
  }

  async _onItemSplit(event) {
    event.preventDefault();
    event.stopPropagation();

    const itemId =
      event.currentTarget.closest("[data-item-id]")?.dataset.itemId ||
      event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const currentAmount = item.system.amount || 1;
    if (currentAmount <= 1) return;

    const actor = this.actor;
    new Dialog({
      title: localize("vehicle.item.splitTitle", { name: item.name }),
      content: `
        <form>
          <div class="form-group">
            <label>${esc(localize("vehicle.item.splitCurrent", { amount: currentAmount }))}</label>
          </div>
          <div class="form-group">
            <label>${esc(localize("vehicle.item.splitAmount"))}</label>
            <input type="number" name="splitAmount" value="1" min="1" max="${currentAmount - 1}"/>
          </div>
        </form>
      `,
      buttons: {
        split: {
          icon: '<i class="fas fa-scissors"></i>',
          label: localize("vehicle.item.split"),
          callback: async (html) => {
            const splitAmount = Math.floor(
              Number(html.find('[name="splitAmount"]').val()) || 1
            );
            if (splitAmount < 1 || splitAmount >= currentAmount) return;

            await item.update({
              "system.amount": currentAmount - splitAmount,
            });
            const newItem = item.toObject();
            newItem.system.amount = splitAmount;
            delete newItem._id;
            await actor.createEmbeddedDocuments("Item", [newItem]);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: localize("vehicle.common.cancel"),
        },
      },
      default: "split",
    }).render(true);
  }

  /* ---------------------------------------------------------------------- */
  /*  Оружие, броня, модификации                                             */
  /* ---------------------------------------------------------------------- */

  async _onWeaponMount(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (!item) return;

    const positions = (
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
    ).filter((pos) => pos.canControlWeapons);
    if (positions.length === 0) {
      ui.notifications.warn(localize("vehicle.notify.noWeaponPositions"));
      return;
    }

    const buttons = {};
    for (const pos of positions) {
      buttons[pos.id] = {
        label: esc(pos.name),
        callback: async () =>
          item.setFlag(MODULE_ID, VEHICLE_FLAGS.mountedPosition, pos.id),
      };
    }
    buttons.cancel = { label: localize("vehicle.common.cancel") };

    new Dialog(
      {
        title: localize("vehicle.weapon.mountTitle", { name: item.name }),
        content: `<p>${esc(localize("vehicle.weapon.mountBody"))}</p>`,
        buttons,
      },
      { classes: ["dialog", "vas-dialog"] }
    ).render(true);
  }

  async _onWeaponUnmount(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) await item.unsetFlag(MODULE_ID, VEHICLE_FLAGS.mountedPosition);
  }

  async _onUpgradeMount(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) await item.setFlag(MODULE_ID, VEHICLE_FLAGS.mounted, true);
  }

  async _onUpgradeUnmount(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) await item.unsetFlag(MODULE_ID, VEHICLE_FLAGS.mounted);
  }

  async _onCyberwareInstall(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) await item.setFlag(MODULE_ID, VEHICLE_FLAGS.installed, true);
  }

  async _onCyberwareUninstall(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) await item.unsetFlag(MODULE_ID, VEHICLE_FLAGS.installed);
  }

  /**
   * Перебирает состояния брони по кругу и переносит её защиту в графы листа.
   *
   * Транспорт держит броню там же, где персонаж, — в `externalData`, поэтому
   * надетая пластина сразу видна в шапке как ОС и ОС головы.
   */
  async _onArmorEquip(event) {
    event.preventDefault();
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const states = ["equipped", "owned", "carried"];
    const current = item.system.equipped || "owned";
    const next = states[(states.indexOf(current) + 1) % states.length];

    await item.update({ "system.equipped": next });

    if (next === "equipped") {
      if (item.system.isBodyLocation) {
        const sp = item.system.bodyLocation?.sp || 0;
        await this.actor.update({
          "system.externalData.currentArmorBody.value":
            sp - (item.system.bodyLocation?.ablation || 0),
          "system.externalData.currentArmorBody.max": sp,
          "system.externalData.currentArmorBody.id": itemId,
        });
      }
      if (item.system.isHeadLocation) {
        const sp = item.system.headLocation?.sp || 0;
        await this.actor.update({
          "system.externalData.currentArmorHead.value":
            sp - (item.system.headLocation?.ablation || 0),
          "system.externalData.currentArmorHead.max": sp,
          "system.externalData.currentArmorHead.id": itemId,
        });
      }
      return;
    }

    if (item.system.isBodyLocation) {
      await this.actor.update({
        "system.externalData.currentArmorBody.value": 0,
        "system.externalData.currentArmorBody.max": 0,
        "system.externalData.currentArmorBody.id": null,
      });
    }
    if (item.system.isHeadLocation) {
      await this.actor.update({
        "system.externalData.currentArmorHead.value": 0,
        "system.externalData.currentArmorHead.max": 0,
        "system.externalData.currentArmorHead.id": null,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Стрельба                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Переключает режим огня и вместе с ним таблицу дальности на токене.
   *
   * Режим хранится во флаге системы, а не модуля: так его видит и штатный код
   * броска. Имена таблиц дальности при этом остаются английскими даже под
   * русским языком — система ищет их точным равенством, и русификация их
   * намеренно не переводит.
   */
  async _onFireCheckboxToggle(event) {
    event.preventDefault();
    try {
      await this._toggleFireMode(event);
    } catch (error) {
      console.error(`${MODULE_ID} | переключение режима огня:`, error);
      ui.notifications.error(
        localize("vehicle.notify.fireModeFailed", {
          message: error?.message ?? String(error),
        })
      );
    }
  }

  async _toggleFireMode(event) {
    const weaponId = event.currentTarget.dataset.itemId;
    const fireMode = event.currentTarget.dataset.fireMode;
    const flag = this.actor.getFlag("cyberpunk-red-core", `firetype-${weaponId}`);

    if (this.token !== null && fireMode === "autofire") {
      const weapon = this.actor.items.get(weaponId);
      const weaponDvTable = weapon.system.dvTable;
      const currentDvTable =
        weaponDvTable === ""
          ? foundry.utils.getProperty(this.token, "flags.cprDvTable")
          : weaponDvTable;

      if (typeof currentDvTable !== "undefined") {
        const dvTable = currentDvTable.replace(" (Autofire)", "");
        const utils = await systemUtils();
        const dvTables = utils ? await utils.GetDvTables() : [];
        const autofireTables = dvTables.filter(
          (table) =>
            table.name.includes(dvTable) && table.name.includes("Autofire")
        );

        let newDvTable = currentDvTable;
        if (autofireTables.length > 0) {
          newDvTable = flag === fireMode ? dvTable : autofireTables[0];
        }
        await this.token.update({ "flags.cprDvTable": newDvTable });
      }
    }

    if (flag === fireMode) {
      await this.actor.unsetFlag("cyberpunk-red-core", `firetype-${weaponId}`);
    } else {
      await this.actor.setFlag(
        "cyberpunk-red-core",
        `firetype-${weaponId}`,
        fireMode
      );
    }
  }

  _getFireCheckbox(weaponId) {
    return (
      this.actor.getFlag("cyberpunk-red-core", `firetype-${weaponId}`) ||
      "attack"
    );
  }

  async _onChangeAmmo(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item?.load) await item.load();
  }

  async _onReload(event) {
    event.preventDefault();
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item?.reload) await item.reload();
  }

  /**
   * Выстрел из закреплённого оружия.
   *
   * Бросок делает не транспорт, а тот, кто сидит на посту: его навык, его
   * характеристики, его удача. В карточку чата при этом уходит транспорт —
   * стреляет ведь машина, и анимация должна идти от её токена.
   */
  async _onWeaponRoll(event) {
    event.preventDefault();
    event.stopPropagation();

    const itemId = event.currentTarget.dataset.itemId;
    const rollTypeFromButton = event.currentTarget.dataset.rollType;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    // Дальше каждая проверка объясняет себя вслух. Раньше все они молча
    // выходили, и на экране не происходило ровно ничего — угадать, чего не
    // хватает, было невозможно.
    const gunner = await this._gunnerFor(item);
    if (!gunner) return;

    const rollType =
      rollTypeFromButton === "attack" ? this._getFireCheckbox(itemId) : "damage";

    // Навык оружия система ищет у стрелка точным именем и без него падает на
    // пустой ссылке. Проверяем заранее, чтобы сказать это человеческими словами.
    const needed =
      rollType === "autofire" || rollType === "suppressive"
        ? "Autofire"
        : item.system.weaponSkill;
    if (
      needed &&
      !gunner.items.some((i) => i.type === "skill" && i.name === needed)
    ) {
      ui.notifications.warn(
        localize("vehicle.notify.noWeaponSkill", {
          actor: gunner.name,
          skill: needed,
          name: item.name,
        })
      );
      return;
    }

    try {
      let cprRoll = item.createRoll(rollType, gunner);
      if (!cprRoll) {
        ui.notifications.warn(
          localize("vehicle.notify.rollUnsupported", {
            name: item.name,
            type: rollType,
          })
        );
        return;
      }

      const keepRolling = await cprRoll.handleRollDialog(event, gunner, item);
      if (!keepRolling) return;

      cprRoll = await item.confirmRoll(cprRoll);
      if (!cprRoll) return;

      await cprRoll.roll();

      if (Number.isInteger(cprRoll.luck) && cprRoll.luck > 0) {
        const luck = gunner.system.stats.luck.value;
        await gunner.update({
          "system.stats.luck.value": luck - Math.min(cprRoll.luck, luck),
        });
      }

      let vehicleTokenId = this.token?.id ?? this.token?._id ?? null;
      if (!vehicleTokenId) {
        const tokens =
          canvas.scene?.tokens?.filter((t) => t.actorId === this.actor.id) || [];
        if (tokens.length > 0) vehicleTokenId = tokens[0].id;
      }

      cprRoll.entityData = {
        actor: this.actor.id,
        token: vehicleTokenId,
        tokens: Array.from(game.user.targets).map((t) => t.id),
        item: item.id,
      };

      const CPRChat = await import(
        `/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`
      );
      await CPRChat.default.RenderRollCard(cprRoll);

      // Мастеру анимацию рисует сам Automated Animations по карточке чата, а
      // игроку — нет: карточка приходит от чужого актёра. Запускаем вручную.
      if (!game.user.isGM && game.modules.get("autoanimations")?.active) {
        const tokenDoc =
          this.token ??
          canvas.scene?.tokens?.find((t) => t.actorId === this.actor.id);
        if (tokenDoc) {
          const tokenObj = tokenDoc.object ?? canvas.tokens.get(tokenDoc.id);
          if (tokenObj && window.AutomatedAnimations?.playAnimation) {
            window.AutomatedAnimations.playAnimation(tokenObj, item, {
              targets: Array.from(game.user.targets),
            });
          }
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | выстрел с поста транспорта:`, error);
      ui.notifications.error(
        localize("vehicle.notify.rollFailed", {
          name: item.name,
          message: error?.message ?? String(error),
        })
      );
    }
  }

  /**
   * Кто стреляет с поста, за которым закреплено оружие.
   *
   * Возвращает null и объясняет причину, если стрелять некому: оружие не
   * закреплено, пост удалён, на посту пусто или актёр пассажира пропал.
   *
   * @param {CPRItem} item - оружие
   * @returns {Promise<CPRActor|null>}
   */
  async _gunnerFor(item) {
    const mountedPos = item.getFlag(MODULE_ID, VEHICLE_FLAGS.mountedPosition);
    if (!mountedPos) {
      ui.notifications.warn(
        localize("vehicle.notify.weaponNotMounted", { name: item.name })
      );
      return null;
    }

    const positions =
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || [];
    const position = positions.find((pos) => pos.id === mountedPos);
    if (!position) {
      ui.notifications.warn(
        localize("vehicle.notify.postGone", { name: item.name })
      );
      return null;
    }

    if (!position.occupants?.length) {
      ui.notifications.warn(
        localize("vehicle.notify.postEmpty", { position: position.name })
      );
      return null;
    }

    const gunner = await fromUuid(position.occupants[0]);
    if (!gunner) {
      ui.notifications.warn(
        localize("vehicle.notify.gunnerGone", { position: position.name })
      );
      return null;
    }
    return gunner;
  }

  /**
   * Бросок навыка за пост.
   *
   * Навык ищется на листе того, кто сидит на посту, — по всем известным
   * написаниям сразу, см. `vehicle-skills.js`. Если не нашли, показываем, что
   * у персонажа вообще есть: так мастер сразу видит, как надо было написать.
   */
  async _onSkillRoll(event) {
    event.preventDefault();
    const positionId = event.currentTarget.dataset.positionId;
    const skillTitle = event.currentTarget.dataset.rollTitle;

    const pos = (
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
    ).find((p) => p.id === positionId);
    if (!pos) return;

    if (!pos.occupants?.length) {
      ui.notifications.warn(
        localize("vehicle.notify.postEmpty", { position: pos.name })
      );
      return;
    }

    const occupant = await fromUuid(pos.occupants[0]);
    if (!occupant) {
      ui.notifications.warn(
        localize("vehicle.notify.gunnerGone", { position: pos.name })
      );
      return;
    }

    const skill = findSkill(occupant, skillTitle);
    if (!skill) {
      ui.notifications.warn(
        localize("vehicle.notify.skillNotFound", {
          skill: skillTitle,
          actor: occupant.name,
          known: skillNamesHint(occupant),
        })
      );
      return;
    }

    let cprRoll = skill.createRoll("skill", occupant);
    const keepRolling = await cprRoll.handleRollDialog(event, occupant, skill);
    if (!keepRolling) return;

    cprRoll = await skill.confirmRoll(cprRoll);
    if (!cprRoll) return;

    await cprRoll.roll();

    if (Number.isInteger(cprRoll.luck) && cprRoll.luck > 0) {
      const luck = occupant.system.stats.luck.value;
      await occupant.update({
        "system.stats.luck.value": luck - Math.min(cprRoll.luck, luck),
      });
    }

    cprRoll.entityData = {
      actor: occupant.id,
      token: this.token?._id ?? null,
      tokens: Array.from(game.user.targets).map((t) => t.id),
      item: skill.id,
    };

    const CPRChat = await import(
      `/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`
    );
    CPRChat.default.RenderRollCard(cprRoll);
  }

  /* ---------------------------------------------------------------------- */
  /*  Бронестекло                                                            */
  /* ---------------------------------------------------------------------- */

  async _onGlassHpClick(event) {
    event.preventDefault();
    const posId = event.currentTarget.dataset.positionId;
    const pos = (
      this.actor.getFlag(MODULE_ID, VEHICLE_FLAGS.positions) || []
    ).find((p) => p.id === posId);
    if (!pos) return;

    new Dialog({
      title: localize("vehicle.glass.title", { position: pos.name }),
      content: `
        <form>
          <div class="form-group">
            <label>${esc(
              localize("vehicle.glass.current", {
                hp: pos.glassHp,
                max: pos.glassHpMax,
              })
            )}</label>
          </div>
          <div class="form-group">
            <label>${esc(localize("vehicle.glass.amount"))}</label>
            <input type="number" name="amount" value="" autofocus/>
          </div>
        </form>
      `,
      buttons: {
        damage: {
          icon: '<i class="fas fa-heart-broken"></i>',
          label: localize("vehicle.glass.damage"),
          callback: async (html) => {
            const amount = Number(html.find('[name="amount"]').val()) || 0;
            await this._updateGlassHp(posId, -amount);
          },
        },
        repair: {
          icon: '<i class="fas fa-wrench"></i>',
          label: localize("vehicle.glass.repair"),
          callback: async (html) => {
            const amount = Number(html.find('[name="amount"]').val()) || 0;
            await this._updateGlassHp(posId, amount);
          },
        },
      },
      default: "damage",
    }).render(true);
  }

  async _updateGlassHp(positionId, change) {
    const positions = this._positions();
    const position = positions.find((pos) => pos.id === positionId);
    if (!position) return;

    position.glassHp = Math.max(
      0,
      Math.min(position.glassHpMax, position.glassHp + change)
    );
    await this._savePositions(positions);
  }

  /* ---------------------------------------------------------------------- */
  /*  Перетаскивание                                                         */
  /* ---------------------------------------------------------------------- */

  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (Hooks.call("dropActorSheetData", this.actor, this, data) === false) {
      return;
    }

    switch (data.type) {
      case "Actor":
        return this._onDropActor(event, data);
      case "Item":
        return this._onDropItem(event, data);
      default:
        return super._onDrop(event);
    }
  }

  async _onDropActor(event, data) {
    if (!this.actor.isOwner || data.uuid === this.actor.uuid) return false;

    const actor = await fromUuid(data.uuid);
    if (!actor) return false;

    const posElement = event.target.closest("[data-position-id]");
    if (!posElement) return false;

    return this._seatOccupant(actor.uuid, posElement.dataset.positionId);
  }

  async _onDropItem(event, data) {
    if (!this.actor.isOwner) return false;
    const item = await Item.implementation.fromDropData(data);
    if (!item) return false;

    if (item.actor?.id === this.actor.id) {
      this._internalDrop = true;
      return this._onSortItem(event, item);
    }
    return this._onDropItemCreate(item, event);
  }

  /**
   * Приём предмета в груз.
   *
   * Стопки складываются: если такой предмет уже лежит, растёт его количество, а
   * не появляется вторая строка. Из источника предмет при этом удаляется —
   * груз переезжает, а не копируется.
   */
  async _onDropItemCreate(itemData, event) {
    const incoming = itemData instanceof Array ? itemData : [itemData];
    const toCreate = [];
    const toDelete = [];

    for (const data of incoming) {
      const sourceActor = data.actor;
      const sourceItemId = data.id || data._id;

      const itemObject = data.toObject
        ? data.toObject()
        : foundry.utils.deepClone(data);
      delete itemObject._id;

      const amount = itemObject.system?.amount;
      if (amount !== undefined && amount !== null) {
        const existing = this.actor.items.find(
          (item) =>
            item.name === itemObject.name && item.type === itemObject.type
        );
        if (existing?.system.amount !== undefined) {
          await existing.update({
            "system.amount": (existing.system.amount || 0) + (amount || 1),
          });
          if (sourceActor && sourceItemId) {
            toDelete.push({ actor: sourceActor, itemId: sourceItemId });
          }
          continue;
        }
      }

      toCreate.push(itemObject);
      if (sourceActor && sourceItemId) {
        toDelete.push({ actor: sourceActor, itemId: sourceItemId });
      }
    }

    if (toCreate.length > 0) {
      await this.actor.createEmbeddedDocuments("Item", toCreate);
    }
    for (const { actor, itemId } of toDelete) {
      await actor.items?.get(itemId)?.delete();
    }
  }

  _onItemDragStart(event) {
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (!item) return;

    event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
    event.dataTransfer.effectAllowed = "copyMove";
    this._draggedItemId = item.id;
  }

  /**
   * Предмет, утащенный с листа наружу, с листа исчезает.
   *
   * Пауза перед удалением — не суеверие: принимающая сторона создаёт копию
   * асинхронно, и если удалить исходник сразу, перетаскивание иногда
   * заканчивается ничем.
   */
  async _onItemDragEnd(event) {
    const itemId = this._draggedItemId;
    this._draggedItemId = null;
    if (!itemId) return;

    if (this._internalDrop) {
      this._internalDrop = false;
      return;
    }
    if (event.dataTransfer.dropEffect === "none") return;

    await new Promise((resolve) => setTimeout(resolve, 150));
    await this.actor.items.get(itemId)?.delete();
  }
}

/**
 * Кнопка «Собрать шестёрку» во вкладке актёров.
 *
 * Конструктор шестёрок (`pneuma-mook-maker`) работает так: он заводит папку
 * `MookMaker/Templates` с заготовкой, заготовку надо ВЫТАЩИТЬ НА СЦЕНУ, и
 * только у полученного токена в меню появляется маленькая иконка шестерёнки,
 * которая и открывает конструктор.
 *
 * Ниоткуда это не следует. Мастер видит папку с актёром, открывает его — и не
 * находит ничего похожего на конструктор: у самого актёра кнопки нет, потому
 * что редактируется не он, а несвязанный токен на сцене.
 *
 * Эта кнопка проходит весь путь за один щелчок: берёт заготовку, ставит токен в
 * центре текущего вида и сразу открывает конструктор.
 *
 * Кнопка живёт здесь, а не в самом конструкторе, намеренно: тот модуль чужой, и
 * его обновление затёрло бы правку. Всё, что нужно от него, — открытая функция
 * `showMookMakerMenu`, и её мы зовём по имени файла.
 */

import { MODULE_ID, SETTINGS, localize } from "./constants.js";

/** Модуль конструктора и его внутренние имена. */
const MOOK_MODULE = "pneuma-mook-maker";
const ROOT_FOLDER = "MookMaker";
const TEMPLATES_FOLDER = "Templates";
const FOLDER_KIND_FLAG = "FolderKind";

/** Включён ли конструктор шестёрок. */
export function mookMakerActive() {
  return Boolean(game.modules?.get(MOOK_MODULE)?.active);
}

/**
 * Папка заготовок конструктора.
 *
 * Ищем так же, как ищет он сам: сперва по флагу, затем по имени — мастер мог
 * завести папку руками, и тогда флага на ней нет.
 *
 * @returns {Folder|null}
 */
export function templatesFolder() {
  for (const folder of game.folders ?? []) {
    if (folder.type !== "Actor") continue;
    const kind = folder.getFlag?.(MOOK_MODULE, FOLDER_KIND_FLAG);
    const named = folder.name === TEMPLATES_FOLDER;
    if (kind !== "templates" && !named) continue;

    const root = folder.folder;
    if (!root || root.type !== "Actor") continue;
    const rootKind = root.getFlag?.(MOOK_MODULE, FOLDER_KIND_FLAG);
    if (rootKind !== "root" && root.name !== ROOT_FOLDER) continue;
    return folder;
  }
  return null;
}

/**
 * Заготовки, из которых можно собрать шестёрку.
 *
 * @returns {Array<Actor>}
 */
export function templateActors() {
  const folder = templatesFolder();
  if (!folder) return [];
  return (game.actors ?? []).filter((actor) => actor.folder?.id === folder.id);
}

/**
 * Куда ставить токен: середина того, что мастер сейчас видит.
 *
 * Ставить в середину СЦЕНЫ неудобно — она может быть далеко за краем экрана, и
 * шестёрка появится там, где её не видно.
 *
 * @param {Object} scene - текущая сцена
 * @returns {Object} - {x, y} в пикселях, выровненные по сетке
 */
export function dropPoint(scene) {
  const pivot = canvas?.stage?.pivot;
  const centre = {
    x: Number.isFinite(pivot?.x) ? pivot.x : (scene?.width ?? 0) / 2,
    y: Number.isFinite(pivot?.y) ? pivot.y : (scene?.height ?? 0) / 2,
  };
  const size = scene?.grid?.size || 100;
  return {
    x: Math.round(centre.x / size) * size,
    y: Math.round(centre.y / size) * size,
  };
}

/**
 * Ставит шестёрку на сцену и открывает конструктор.
 *
 * @async
 * @param {Actor} template - заготовка
 * @returns {Promise<Boolean>} - дошли ли до конструктора
 */
export async function buildMook(template) {
  if (!canvas?.scene) {
    ui.notifications.warn(localize("mook.noScene"));
    return false;
  }

  const point = dropPoint(canvas.scene);
  // Токен НЕСВЯЗАННЫЙ: конструктор правит именно копию на сцене, а связанный
  // тянул бы правки в саму заготовку — и следующая шестёрка вышла бы такой же.
  const data = await template.getTokenDocument({
    x: point.x,
    y: point.y,
    actorLink: false,
  });

  const [created] = await canvas.scene.createEmbeddedDocuments("Token", [
    data.toObject(),
  ]);
  if (!created) {
    ui.notifications.error(localize("mook.notPlaced"));
    return false;
  }

  const placeable = created.object ?? canvas.tokens?.get(created.id);
  const { showMookMakerMenu } = await import(
    `/modules/${MOOK_MODULE}/scripts/mook-form.js`
  );
  await showMookMakerMenu(placeable);
  return true;
}

/**
 * Спрашивает, из какой заготовки собирать, если их несколько.
 *
 * @async
 * @returns {Promise<Actor|null>}
 */
async function chooseTemplate() {
  const templates = templateActors();
  if (!templates.length) {
    ui.notifications.warn(localize("mook.noTemplate", { folder: `${ROOT_FOLDER}/${TEMPLATES_FOLDER}` }));
    return null;
  }
  if (templates.length === 1) return templates[0];

  const options = templates
    .map((actor) => `<option value="${actor.id}">${Handlebars.escapeExpression(actor.name)}</option>`)
    .join("");

  return new Promise((resolve) => {
    new Dialog({
      title: localize("mook.chooseTitle"),
      content:
        `<p>${localize("mook.chooseLead")}</p>` +
        `<p><select name="template" style="width:100%">${options}</select></p>`,
      buttons: {
        ok: {
          label: localize("mook.build"),
          callback: (html) => {
            const id = html.find('select[name="template"]').val();
            resolve(templates.find((actor) => actor.id === id) ?? null);
          },
        },
        cancel: { label: localize("mook.cancel"), callback: () => resolve(null) },
      },
      default: "ok",
      close: () => resolve(null),
    }).render(true);
  });
}

/**
 * Дописывает кнопку в заголовок вкладки актёров.
 *
 * @param {Application} app - боковая вкладка
 * @param {jQuery} html - её разметка
 * @returns {Boolean} - добавлена ли кнопка
 */
export function injectMookButton(app, html) {
  if (!game.user?.isGM || !mookMakerActive()) return false;

  const root = html?.[0] ?? html;
  if (!root?.querySelector) return false;
  if (root.querySelector(".cpr-addenda-build-mook")) return false;

  // Цепляемся за строку действий папки, а не за произвольное место: она есть у
  // вкладки всегда, и кнопка встаёт рядом с «Создать актёра».
  const header =
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header");
  if (!header) return false;

  const label = localize("mook.build");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cpr-addenda-build-mook";
  button.title = localize("mook.buildHint");
  button.innerHTML = `<i class="fas fa-user-gear"></i> ${label}`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      const template = await chooseTemplate();
      if (template) await buildMook(template);
    } catch (error) {
      console.error(`${MODULE_ID} | не удалось собрать шестёрку:`, error);
      ui.notifications.error(localize("mook.failed"));
    }
  });

  header.append(button);
  return true;
}

/** Подключает кнопку к вкладке актёров. */
export function registerMookButton() {
  Hooks.on("renderActorDirectory", (app, html) => {
    try {
      if (!game.settings.get(MODULE_ID, SETTINGS.mookButton)) return;
      injectMookButton(app, html);
    } catch (error) {
      console.error(`${MODULE_ID} | кнопка сборки шестёрки не добавлена:`, error);
    }
  });
}

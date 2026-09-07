/**
 * Кнопка «Собрать шестёрку» во вкладке актёров.
 *
 * Это проводник к чужому конструктору (Pneuma Mook Maker). Тот работает так:
 * заводит папку `MookMaker/Templates` с заготовкой, заготовку надо ВЫТАЩИТЬ НА
 * СЦЕНУ, и только у полученного токена в меню появляется маленькая иконка
 * шестерёнки, которая и открывает конструктор.
 *
 * Ниоткуда это не следует. Мастер видит папку с актёром, открывает его — и не
 * находит ничего похожего на конструктор: у самого актёра кнопки нет, потому
 * что редактируется не он, а несвязанный токен на сцене. Кнопка проходит весь
 * путь за один щелчок.
 *
 * Кнопка живёт здесь, а не в самом конструкторе, намеренно: тот модуль чужой, и
 * его обновление затёрло бы правку. Всё, что нужно от него, — открытая функция
 * `showMookMakerMenu`, и её мы зовём по имени файла.
 *
 * Раскладчик случайных шестёрок жил рядом и переехал в отдельный модуль
 * `cpr-mook-randomizer`: он ни от чего здесь не зависел, а две одинаковые
 * кнопки в одной вкладке — худшее из решений.
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
/**
 * Дописывает кнопку в заголовок вкладки актёров.
 *
 * Без конструктора шестёрок кнопка бессмысленна, поэтому появляется только
 * когда тот включён.
 *
 * @param {Application} app - боковая вкладка
 * @param {jQuery} html - её разметка
 * @returns {Boolean} - добавлена ли кнопка
 */
export function injectMookButton(app, html) {
  if (!game.user?.isGM || !mookMakerActive()) return false;

  const root = html?.[0] ?? html;
  if (!root?.querySelector) return false;
  if (root.querySelector(".cpr-addenda-mook-row")) return false;

  // Цепляемся за шапку вкладки, а не за строку с «Создать актёра». Соседние
  // модули вешают свои кнопки отдельными строками под ней, и кнопка во всю
  // ширину встаёт в общий ряд, а не сжимает системные.
  const header = root.querySelector(".directory-header");
  if (!header) return false;

  const row = document.createElement("div");
  row.className = "header-actions action-buttons flexrow cpr-addenda-mook-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cpr-addenda-build-mook";
  button.title = localize("mook.buildHint");
  button.innerHTML = `<i class="fas fa-user-gear"></i> ${localize("mook.build")}`;
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

  row.append(button);
  header.append(row);
  return true;
}

/**
 * Подключает кнопку к вкладке актёров.
 *
 * Зовётся из `init`, а НЕ из `ready`: боковая панель рисуется один раз при
 * запуске, и обработчик, повешенный позже, к ней уже не успевает — кнопка не
 * появлялась до тех пор, пока вкладку не перерисует что-нибудь ещё.
 */
export function registerMookButton() {
  Hooks.on("renderActorDirectory", (app, html) => {
    try {
      // Настройка читается в момент отрисовки, а не подключения. Если её ещё не
      // объявили — показываем кнопку: спрятать её молча хуже, чем показать
      // лишний раз, потому что искать пропажу мастеру негде.
      let enabled = true;
      try {
        enabled = game.settings.get(MODULE_ID, SETTINGS.mookButton);
      } catch (error) {
        console.warn(`${MODULE_ID} | настройка кнопки шестёрки ещё не готова`, error);
      }
      if (!enabled) return;
      injectMookButton(app, html);
    } catch (error) {
      console.error(`${MODULE_ID} | кнопка сборки шестёрки не добавлена:`, error);
    }
  });
}

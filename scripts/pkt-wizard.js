/**
 * Мастер установки корпуса ПКТ.
 *
 * Полная конверсия тела — не «перетащил предмет и пошёл дальше». В комплекте
 * полтора-два десятка имплантов, документ делит их на два столбца — что ставится
 * без потери человечности, а что с ней, — и за весь комплект назначает одну
 * общую потерю, обычно два-три десятка очков. Раньше всё это происходило молча:
 * комплект раскладывался сам, а человечность списывалась потом, отдельным
 * системным окном, где не было видно ни за что именно платят, ни куда что встало.
 *
 * Поэтому здесь пошаговое окно. Оно ничего не решает за игрока — оно показывает,
 * что произойдёт, и даёт отказаться на любом шаге:
 *
 *   1. Точно ли ставим этот корпус — с ценой и общей потерей человечности.
 *   2. Что войдёт без потери человечности.
 *   3. Что войдёт с потерей и куда именно — опция за опцией по своим
 *      фундаментам; здесь же бросок или среднее значение.
 *   4. Итог: оба списка, занятые слоты и сколько человечности ушло.
 *
 * Средним значением можно обойтись не по доброте: правила ПКТ разрешают это
 * прямо — «пользователь, устанавливаемый в корпус ПКТ, может принять среднюю ПЧ
 * вместо того, чтобы делать бросок на нее».
 *
 * Разбор комплекта вынесен в чистые функции: окно только рисует то, что они
 * посчитали, и потому их можно проверить без запущенного Foundry.
 */

import { MODULE_ID, SYSTEM_ID, localize } from "./constants.js";
import { getKit, deployKit, kitPartsOf } from "./pkt-kit.js";

/** Группы из таблицы документа. */
const FREE = "free";
const COST = "cost";

/**
 * Экранирование: в окно идут названия имплантов, а их пишет документ.
 *
 * @param {String} text - произвольная строка
 * @returns {String}
 */
function esc(text) {
  return Handlebars.escapeExpression(String(text ?? ""));
}

/**
 * Группа импланта: с потерей человечности он ставится или без.
 *
 * @param {Object} doc - имплант комплекта
 * @returns {String} - "free" или "cost"
 */
export function groupOf(doc) {
  return doc?.flags?.[MODULE_ID]?.pktGroup === COST ? COST : FREE;
}

/**
 * Складывает одинаковые импланты в «имя ×N», сохраняя порядок документа.
 *
 * @param {Array<Object>} docs - импланты
 * @returns {Array<Object>} - [{name, count}]
 */
export function countByName(docs) {
  const order = [];
  const counts = new Map();
  for (const doc of docs ?? []) {
    const name = doc?.name ?? "";
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return order.map((name) => ({ name, count: counts.get(name) }));
}

/**
 * Разбирает комплект в то, что показывает окно.
 *
 * Считаем и слоты: у киберруки их четыре, и если документ занял две, это надо
 * видеть до установки, а не выяснять потом, когда некуда поставить своё.
 *
 * @param {Object} kit - комплект из флага корпуса
 * @returns {Object} - разбор для окна
 */
export function summariseKit(kit) {
  const foundations = kit?.foundations ?? [];
  const carried = kit?.carried ?? [];

  const all = [];
  const places = [];

  for (const entry of foundations) {
    const host = entry?.item ?? {};
    const options = entry?.options ?? [];
    all.push(host, ...options);
    const slots = host.system?.installedItems?.slots ?? 0;
    const used = options.reduce((sum, o) => sum + (o.system?.size ?? 1), 0);
    places.push({
      host: host.name ?? "",
      hostGroup: groupOf(host),
      options: options.map((o) => ({ name: o.name ?? "", group: groupOf(o) })),
      used,
      slots,
    });
  }
  all.push(...carried);

  return {
    free: countByName(all.filter((d) => groupOf(d) === FREE)),
    cost: countByName(all.filter((d) => groupOf(d) === COST)),
    places,
    frame: {
      items: carried.map((d) => ({ name: d.name ?? "", group: groupOf(d) })),
      used: carried.reduce((sum, d) => sum + (d.system?.size ?? 1), 0),
    },
    total: all.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Разметка шагов                                                     */
/* ------------------------------------------------------------------ */

/** Список «имя ×N» строками. */
function listOf(entries) {
  if (!entries.length) return `<p><em>${localize("pkt.wizard.nothing")}</em></p>`;
  return (
    "<ul class='cpr-addenda-pkt-list'>" +
    entries
      .map(
        (e) =>
          `<li>${esc(e.name)}${e.count > 1 ? ` <span class="count">×${e.count}</span>` : ""}</li>`
      )
      .join("") +
    "</ul>"
  );
}

/**
 * Шаг 1: подтверждение.
 *
 * @param {CPRItem} frame - корпус
 * @param {Object} view - разбор комплекта
 * @returns {String}
 */
export function stepConfirm(frame, view) {
  const humanity = frame.system?.humanityLoss ?? {};
  return (
    `<p>${localize("pkt.wizard.confirm.lead", { name: esc(frame.name) })}</p>` +
    "<dl class='cpr-addenda-pkt-facts'>" +
    `<dt>${localize("pkt.wizard.facts.implants")}</dt><dd>${view.total}</dd>` +
    `<dt>${localize("pkt.wizard.facts.free")}</dt><dd>${view.free.reduce((s, e) => s + e.count, 0)}</dd>` +
    `<dt>${localize("pkt.wizard.facts.cost")}</dt><dd>${view.cost.reduce((s, e) => s + e.count, 0)}</dd>` +
    `<dt>${localize("pkt.wizard.facts.humanity")}</dt>` +
    `<dd>${esc(humanity.roll ?? "?")} — ${localize("pkt.wizard.facts.average", { value: humanity.static ?? 0 })}</dd>` +
    "</dl>" +
    `<p class='cpr-addenda-pkt-warn'>${localize("pkt.wizard.confirm.warn")}</p>`
  );
}

/**
 * Шаг 2: без потери человечности.
 *
 * @param {Object} view - разбор комплекта
 * @returns {String}
 */
export function stepFree(view) {
  return (
    `<p>${localize("pkt.wizard.free.lead")}</p>` +
    listOf(view.free) +
    `<p class='cpr-addenda-pkt-note'>${localize("pkt.wizard.free.note")}</p>`
  );
}

/**
 * Шаг 3: с потерей человечности, с раскладкой по фундаментам.
 *
 * @param {CPRItem} frame - корпус
 * @param {Object} view - разбор комплекта
 * @param {Object|null} chosen - выбранная потеря, если уже выбрана
 * @returns {String}
 */
export function stepCost(frame, view, chosen, isMook = false) {
  const humanity = frame.system?.humanityLoss ?? {};

  // Показываем только те фундаменты, куда что-то встаёт: пустая киберрука в
  // этом списке ничего не объясняет, а строчек добавляет.
  const rows = view.places
    .filter((p) => p.options.length)
    .map(
      (p) =>
        `<li><strong>${esc(p.host)}</strong> ` +
        `<span class="slots">${localize("pkt.wizard.slots", { used: p.used, slots: p.slots })}</span>` +
        "<ul>" +
        p.options
          .map(
            (o) =>
              `<li>${esc(o.name)}` +
              (o.group === FREE ? ` <span class="free">${localize("pkt.wizard.markFree")}</span>` : "") +
              "</li>"
          )
          .join("") +
        "</ul></li>"
    );

  if (view.frame.items.length) {
    rows.push(
      `<li><strong>${esc(frame.name)}</strong> ` +
        `<span class="slots">${localize("pkt.wizard.inFrame")}</span><ul>` +
        view.frame.items
          .map(
            (o) =>
              `<li>${esc(o.name)}` +
              (o.group === FREE ? ` <span class="free">${localize("pkt.wizard.markFree")}</span>` : "") +
              "</li>"
          )
          .join("") +
        "</ul></li>"
    );
  }

  const decisionKey = {
    static: "pkt.wizard.tookAverage",
    roll: "pkt.wizard.rolled",
    none: "pkt.wizard.tookNone",
  };
  const decision = chosen
    ? `<p class='cpr-addenda-pkt-done'>${localize(decisionKey[chosen.type], {
        value: chosen.value,
      })}</p>`
    : `<p class='cpr-addenda-pkt-note'>${localize("pkt.wizard.cost.choose")}</p>`;

  return (
    `<p>${localize("pkt.wizard.cost.lead")}</p>` +
    (rows.length
      ? `<ul class='cpr-addenda-pkt-tree'>${rows.join("")}</ul>`
      : `<p><em>${localize("pkt.wizard.nothing")}</em></p>`) +
    "<hr>" +
    `<p>${localize("pkt.wizard.cost.humanity", {
      formula: esc(humanity.roll ?? "?"),
      average: humanity.static ?? 0,
    })}</p>` +
    (isMook
      ? `<p class='cpr-addenda-pkt-warn'>${localize("pkt.wizard.mookNote")}</p>`
      : "") +
    decision
  );
}

/**
 * Шаг 4: итог.
 *
 * @param {CPRItem} frame - корпус
 * @param {Object} view - разбор комплекта
 * @param {Object|null} chosen - выбранная потеря
 * @returns {String}
 */
export function stepSummary(frame, view, chosen) {
  const slots = view.places
    .map(
      (p) =>
        `<li>${esc(p.host)}: <span class="slots">${localize("pkt.wizard.slots", {
          used: p.used,
          slots: p.slots,
        })}</span></li>`
    )
    .join("");

  return (
    `<p>${localize("pkt.wizard.summary.lead", { name: esc(frame.name) })}</p>` +
    `<h3>${localize("pkt.wizard.summary.free")}</h3>` +
    listOf(view.free) +
    `<h3>${localize("pkt.wizard.summary.cost")}</h3>` +
    listOf(view.cost) +
    `<h3>${localize("pkt.wizard.summary.slots")}</h3>` +
    `<ul class='cpr-addenda-pkt-list'>${slots}</ul>` +
    `<p class='cpr-addenda-pkt-done'>${localize(
      chosen?.type === "none"
        ? "pkt.wizard.summary.noHumanity"
        : "pkt.wizard.summary.humanity",
      { value: chosen?.value ?? 0 }
    )}</p>`
  );
}

/**
 * Считает потерю человечности, ничего пока не меняя.
 *
 * Бросок делается здесь, чтобы игрок увидел число сразу — но к листу оно не
 * применяется: до последнего шага мастер ещё может отказаться, и списанная
 * человечность за отменённую установку не возвращалась бы ниоткуда. Ровно так
 * и вышло у мастера: он прокрутил бросок, вышел из окна, корпус исчез, а
 * тридцать с лишним очков остались потерянными.
 *
 * @async
 * @param {CPRItem} frame - корпус
 * @param {String} type - "roll", "static" или "none"
 * @returns {Promise<Object>} - {type, value}
 */
async function measureHumanity(frame, type) {
  const humanity = frame.system?.humanityLoss ?? {};
  if (type === "none") return { type, value: 0 };
  if (type === "static") return { type, value: Number(humanity.static) || 0 };

  // Бросок катим системным классом: карточка в чате выглядит как любая другая
  // потеря человечности, и мастер видит выпавшие грани.
  const CPRRolls = await import(`/systems/${SYSTEM_ID}/modules/rolls/cpr-rolls.js`);
  const CPRChat = await import(`/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`);
  const roll = new CPRRolls.CPRHumanityLossRoll(frame.name, `${humanity.roll}`);
  await roll.roll();
  roll.entityData = { actor: frame.parent?.id, static: false };
  CPRChat.default.RenderRollCard(roll);
  return { type, value: roll.resultTotal };
}

/**
 * Списывает посчитанную потерю человечности.
 *
 * Повторяет то, что делает системный `loseHumanityValue`, но применяет уже
 * известное число, а не бросает заново: бросок был на третьем шаге, и второй
 * дал бы другой результат, чем показанный.
 *
 * @async
 * @param {CPRActor} actor - персонаж
 * @param {Object} chosen - {type, value}
 * @returns {Promise<void>}
 */
async function applyHumanity(actor, chosen) {
  if (!chosen || chosen.value <= 0) return;
  const humanity = actor.system?.derivedStats?.humanity ?? {};
  const before = Number.isInteger(humanity.value) ? humanity.value : humanity.max;
  const value = (Number(before) || 0) - chosen.value;
  await actor.update({ "system.derivedStats.humanity.value": value });
  await actor.setMaxHumanity();
  if (value <= 0) ui.notifications.warn(localize("pkt.wizard.cyberpsycho"));
}

/* ------------------------------------------------------------------ */
/*  Окно                                                               */
/* ------------------------------------------------------------------ */

/**
 * Показывает один шаг и ждёт нажатия.
 *
 * Закрытие крестиком — это отказ: молчаливое «как будто нажали Далее» здесь
 * означало бы необратимую операцию, сделанную по недоразумению.
 *
 * @param {Object} options - {title, content, buttons}
 * @returns {Promise<String>} - какая кнопка нажата
 */
function askStep({ title, content, buttons }) {
  return new Promise((resolve) => {
    let answered = null;
    new Dialog(
      {
        title,
        content: `<div class="cpr-addenda-pkt-wizard">${content}</div>`,
        buttons: Object.fromEntries(
          buttons.map((b) => [
            b.key,
            {
              label: b.label,
              icon: b.icon ? `<i class="${b.icon}"></i>` : undefined,
              callback: () => {
                answered = b.key;
              },
            },
          ])
        ),
        default: buttons[buttons.length - 1].key,
        close: () => resolve(answered ?? "cancel"),
      },
      { classes: ["cpr-addenda", "dialog", "cpr-addenda-pkt-dialog"], width: 520 }
    ).render(true);
  });
}

/**
 * Проводит установку корпуса по шагам.
 *
 * @async
 * @param {CPRItem} frame - корпус, уже созданный на актёре
 * @returns {Promise<Boolean>} - установили или отказались
 */
export async function runPktWizard(frame) {
  const kit = getKit(frame);
  const actor = frame?.parent;
  if (!kit || !(actor instanceof Actor)) return false;

  const view = summariseKit(kit);
  // Лист «шестёрки» можно открыть у актёра любого типа, поэтому смотрим не на
  // тип, а на то, каким листом его сейчас показывают, — как это делает система.
  const isMook =
    actor.type === "mook" ||
    Object.values(actor.apps ?? {}).some((app) =>
      String(app?.constructor?.name ?? "").includes("Mook")
    );
  const title = localize("pkt.wizard.title", { name: frame.name });
  const back = { key: "back", label: localize("pkt.wizard.back"), icon: "fas fa-arrow-left" };
  const next = { key: "next", label: localize("pkt.wizard.next"), icon: "fas fa-arrow-right" };
  const no = { key: "cancel", label: localize("pkt.wizard.no"), icon: "fas fa-times" };

  let step = 0;
  let chosen = null;

  while (step < 4) {
    let answer;
    if (step === 0) {
      answer = await askStep({
        title,
        content: stepConfirm(frame, view),
        buttons: [no, { key: "next", label: localize("pkt.wizard.yes"), icon: "fas fa-check" }],
      });
    } else if (step === 1) {
      answer = await askStep({
        title,
        content: stepFree(view),
        buttons: [back, no, next],
      });
    } else if (step === 2) {
      const humanity = frame.system?.humanityLoss ?? {};
      const buttons = [
        back,
        {
          key: "roll",
          label: localize("pkt.wizard.roll", { formula: humanity.roll ?? "?" }),
          icon: "fas fa-dice-d6",
        },
        {
          key: "average",
          label: localize("pkt.wizard.average", { value: humanity.static ?? 0 }),
          icon: "fas fa-equals",
        },
      ];
      // У «шестёрок» человечность в Cyberpunk RED не отслеживается — система
      // сама так и пишет. Но её формула всё равно пересчитывает ЭМП из
      // человечности, и полсотни очков за корпус уводят непися в минус. Даём
      // мастеру отказаться от списания, а на листе НИП это ещё и предлагаем.
      buttons.push({
        key: "none",
        label: localize("pkt.wizard.noHumanity"),
        icon: "fas fa-ban",
      });
      // Дальше пускаем только когда с человечностью решили: иначе итог на
      // последнем шаге пришлось бы показывать с пустым местом.
      if (chosen) buttons.push(next);
      else buttons.push(no);

      answer = await askStep({
        title,
        content: stepCost(frame, view, chosen, isMook),
        buttons,
      });

      if (answer === "roll" || answer === "average" || answer === "none") {
        const type =
          answer === "roll" ? "roll" : answer === "average" ? "static" : "none";
        chosen = await measureHumanity(frame, type);
        // Остаёмся на этом же шаге: игрок должен увидеть результат броска
        // прежде, чем идти к итогу. К листу число пока не применяется —
        // это произойдёт только после «Установить».
        continue;
      }
    } else {
      answer = await askStep({
        title,
        content: stepSummary(frame, view, chosen),
        buttons: [
          back,
          no,
          { key: "next", label: localize("pkt.wizard.install"), icon: "fas fa-check" },
        ],
      });
    }

    if (answer === "cancel") return false;
    if (answer === "back") {
      step = Math.max(step - 1, 0);
      continue;
    }
    step += 1;
  }

  // Порядок важен: сперва раскладываем комплект, потом ставим сам корпус и
  // только в самом конце трогаем человечность. Отказ на любом шаге до этой
  // строки не стоит игроку ничего.
  const deployed = await deployKit(frame);
  if (!frame.system?.isInstalledInActor) await actor.installItems([frame]);
  await applyHumanity(actor, chosen);

  // Ноль сам по себе ещё не беда: комплект мог быть разложен раньше, и
  // `deployKit` тогда честно ничего не делает. Тревога — когда после установки
  // на листе нет ни одной части комплекта. Молчать об этом нельзя: со стороны
  // это неотличимо от «модуль ничего не сделал», а мастер именно это и увидел.
  if (!deployed && !kitPartsOf(actor, frame.id).length) {
    ui.notifications.warn(localize("pkt.wizard.nothingDeployed", { name: frame.name }));
  }
  return true;
}

/** Внутренности для самопроверки. */
export const __test = { FREE, COST, listOf, measureHumanity, applyHumanity };

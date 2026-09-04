/**
 * Проверка текстов: всё, что модуль просит показать, должно существовать.
 *
 * Ненайденный ключ Foundry не считает ошибкой — он просто выводит сам ключ.
 * Поэтому мастер видит «CPRADDENDA.pkt.deployed» вместо сообщения, в консоли
 * тихо, и заметить это можно только глазами и только если дойти до нужной
 * кнопки. Ни одного сообщения, показанного текстом ключа, найти не удалось —
 * проверка стоит, чтобы так и осталось.
 *
 * Здесь ключи собираются из исходников и сверяются с обоими языками в обе
 * стороны: и что просимое существует, и что языки не разъехались между собой.
 *
 * Словарь читается так же, как его читает Foundry. `game.i18n.localize` зовёт
 * `getProperty(translations, "CPRADDENDA.pkt.deployed")`, а тот СНАЧАЛА пробует
 * ключ целиком и только потом идёт по вложенности. Поэтому обе записи рабочие:
 *
 *     "CPRADDENDA.pkt.deployed": "..."                     плоская
 *     "CPRADDENDA": { "pkt": { "deployed": "..." } }        вложенная
 *
 * и в файлах модуля есть обе. Проверка, считающая только плоские, объявила бы
 * вложенные пропавшими — и «починка» добавила бы плоский дубль, который молча
 * перекрыл бы существующий текст, потому что целый ключ проверяется первым.
 *
 *   node tools/selftest-i18n.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(HERE, "..");
const LANG = path.join(MODULE_ROOT, "lang");

let checks = 0;
let failures = 0;

function expect(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`  ПРОВАЛ: ${message}`);
}

/** Свой префикс модуля: localize() дописывает его сам. */
const PREFIX = "CPRADDENDA.";

/** Папки, куда заглядывать незачем. */
const SKIP = new Set([".git", "node_modules", "pdfs", "packs", "sources", "docs"]);

/** Расширения, в которых бывают ключи. */
const CODE = new Set([".js", ".mjs", ".hbs", ".html"]);

function sources(dir = MODULE_ROOT, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      sources(path.join(dir, entry.name), found);
      continue;
    }
    if (CODE.has(path.extname(entry.name))) found.push(path.join(dir, entry.name));
  }
  return found;
}

/**
 * Разворачивает словарь в плоские пути — так же, как их видит `getProperty`.
 *
 * @param {Object} tree - содержимое языкового файла
 * @param {String} prefix - путь до текущего узла
 * @param {Object} flat - накопитель
 * @returns {Object} - путь -> текст
 */
function flatten(tree, prefix = "", flat = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Ключ целиком тоже рабочий путь: getProperty пробует его первым.
      flatten(value, full, flat);
    } else {
      flat[full] = value;
    }
  }
  return flat;
}

const ruRaw = JSON.parse(fs.readFileSync(path.join(LANG, "ru.json"), "utf-8"));
const enRaw = JSON.parse(fs.readFileSync(path.join(LANG, "en.json"), "utf-8"));
const ru = flatten(ruRaw);
const en = flatten(enRaw);

console.log("Языки не разъехались");
{
  const onlyRu = Object.keys(ru).filter((k) => !(k in en));
  const onlyEn = Object.keys(en).filter((k) => !(k in ru));
  expect(onlyRu.length === 0, `есть по-русски, но не по-английски: ${onlyRu.join(", ")}`);
  expect(onlyEn.length === 0, `есть по-английски, но не по-русски: ${onlyEn.join(", ")}`);
  expect(Object.keys(ru).length === Object.keys(en).length, "число ключей разное");

  // Пустой перевод хуже отсутствующего: он выглядит как рабочий.
  for (const [key, value] of Object.entries(ru)) {
    expect(typeof value === "string" && value.trim() !== "", `пустой русский текст: ${key}`);
  }
  for (const [key, value] of Object.entries(en)) {
    expect(typeof value === "string" && value.trim() !== "", `пустой английский текст: ${key}`);
  }
  console.log(`  ключей: ${Object.keys(ru).length}`);
}

console.log("Все запрошенные ключи существуют");
{
  const files = sources();
  const used = new Map(); // ключ -> где встретился
  const dynamic = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf-8");
    const where = path.relative(MODULE_ROOT, file);

    for (const match of text.matchAll(/\blocalize\(\s*"([^"]+)"/g)) {
      used.set(match[1], where);
    }
    for (const match of text.matchAll(/i18n\.(?:localize|format)\(\s*"([^"]+)"/g)) {
      used.set(match[1], where);
    }
    // Ключи, собранные из кусков, автоматически не проверить — считаем и
    // показываем, чтобы про них не забыли.
    for (const match of text.matchAll(/localize\(\s*`([^`]*\$\{[^`]*)`/g)) {
      dynamic.push({ where, pattern: match[1] });
    }
  }

  expect(used.size > 50, `ключей нашлось всего ${used.size} — сбор явно не сработал`);

  for (const [key, where] of used) {
    // Чужие ключи — системы и ядра Foundry — не наша забота.
    if (!key.startsWith(PREFIX) && key.includes(".") && !key.startsWith("pkt.")) {
      const ours = /^[a-z][a-zA-Z0-9]*\./.test(key);
      if (!ours) continue;
    }
    const full = key.startsWith(PREFIX) ? key : PREFIX + key;
    expect(full in ru, `нет русского текста для «${key}» (${where})`);
    expect(full in en, `нет английского текста для «${key}» (${where})`);
  }
  console.log(`  проверено ключей: ${used.size}, файлов: ${files.length}`);

  if (dynamic.length) {
    console.log(`  собираются из кусков (${dynamic.length}, проверяются ниже):`);
    for (const item of dynamic) console.log(`    ${item.where}: ${item.pattern}`);
  }
}

console.log("Ключи, собранные из кусков");
{
  // Единственное такое место у модуля — сообщения об исправлениях системы.
  // Их набор известен: сколько починок объявлено, столько и текстов.
  const fixes = fs.readFileSync(path.join(MODULE_ROOT, "scripts", "system-fixes.js"), "utf-8");
  const kinds = [...fixes.matchAll(/what:\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(kinds.length > 0, "в system-fixes.js не нашлось ни одной починки");

  for (const kind of kinds) {
    const key = `${PREFIX}fixes.${kind}.applied`;
    expect(key in ru, `нет русского текста для починки «${kind}»`);
    expect(key in en, `нет английского текста для починки «${kind}»`);
  }
  console.log(`  починок: ${kinds.length} (${kinds.join(", ")})`);
}

console.log("Нет путей, записанных дважды");
{
  // Один путь, записанный и плоско, и вложенно, — ловушка: getProperty вернёт
  // плоский, а править станут вложенный, и текст «не меняется».
  for (const [name, raw] of [["русском", ruRaw], ["английском", enRaw]]) {
    const flatKeys = Object.keys(raw).filter((k) => k.includes("."));
    const nested = flatten(
      Object.fromEntries(Object.entries(raw).filter(([k]) => !k.includes(".")))
    );
    const both = flatKeys.filter((k) => k in nested);
    expect(both.length === 0, `в ${name} путь записан дважды: ${both.join(", ")}`);
  }
}

console.log("Подстановки совпадают в обоих языках");
{
  // {frame}, {count} и прочее: если в переводе опечатка в имени подстановки,
  // игрок увидит «{frame}» вместо названия корпуса.
  const holes = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  for (const key of Object.keys(ru)) {
    if (!(key in en)) continue;
    const left = holes(ru[key]);
    const right = holes(en[key]);
    const missing = [...left].filter((h) => !right.has(h));
    const extra = [...right].filter((h) => !left.has(h));
    expect(
      missing.length === 0 && extra.length === 0,
      `у «${key}» разные подстановки: только в ru ${missing.join(",") || "—"}, только в en ${extra.join(",") || "—"}`
    );
  }
}

console.log(`\nПроверок выполнено: ${checks}, провалов: ${failures}`);
process.exit(failures ? 1 : 0);

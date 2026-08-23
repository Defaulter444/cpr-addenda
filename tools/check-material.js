/**
 * Сверка материала с тем, что уже есть.
 *
 * На вход — список названий из книги или дополнения: текстовый файл по позиции
 * на строку, либо JSON-массив строк. На выход — три группы:
 *
 *   ЕСТЬ      — нашлось точное совпадение, добавлять нечего;
 *   ПОХОЖЕ    — нашлось близкое название, надо посмотреть глазами;
 *   НЕТ       — не нашлось ничего, кандидат в модуль.
 *
 * Ищет и по английским названиям, и по русским переводам Babele, так что
 * список можно давать на любом языке.
 *
 *   node tools/build-index.js                     — сперва собрать индекс
 *   node tools/check-material.js список.txt       — затем сверить
 *   node tools/check-material.js список.txt --json результат.json
 */

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.resolve(__dirname, "index.json");

/**
 * Приводит название к виду, пригодному для сравнения: без регистра, лишней
 * пунктуации и разнобоя в дефисах.
 *
 * @param {String} value
 * @returns {String}
 */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'’`]/g, "")
    .replace(/[\s\-–—_.,:;()[\]/]+/g, " ")
    .trim();
}

/**
 * Расстояние Левенштейна — ловит опечатки и разночтения перевода.
 *
 * @param {String} a
 * @param {String} b
 * @returns {Number}
 */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Разбирает файл со списком позиций.
 *
 * @param {String} filePath
 * @returns {Array<String>}
 */
function readMaterial(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(String) : Object.keys(data);
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter(Boolean);
}

function main() {
  const [, , materialPath, ...rest] = process.argv;

  if (!materialPath) {
    console.error(
      "Укажите файл со списком позиций:\n  node tools/check-material.js список.txt"
    );
    process.exit(1);
  }
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(
      "Индекс не найден. Сначала выполните:\n  node tools/build-index.js"
    );
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  const names = readMaterial(materialPath);

  // Один проход по индексу вместо прохода на каждое искомое название.
  const exactMap = new Map();
  for (const rec of index) {
    for (const variant of [rec.name, rec.nameRu]) {
      if (!variant) continue;
      const key = normalize(variant);
      if (!exactMap.has(key)) exactMap.set(key, []);
      exactMap.get(key).push(rec);
    }
  }

  const results = names.map((query) => {
    const key = normalize(query);
    const exact = exactMap.get(key);
    if (exact?.length) return { query, verdict: "exact", matches: exact };

    const near = [];
    for (const rec of index) {
      for (const variant of [rec.name, rec.nameRu]) {
        if (!variant) continue;
        const other = normalize(variant);
        const contains = other.includes(key) || key.includes(other);
        // Порог в четверть длины прощает окончание и одну-две опечатки,
        // но не склеивает «Глушитель» с «Гранатомёт».
        const close =
          distance(key, other) <= Math.max(2, Math.floor(key.length / 4));
        if (contains || close) {
          near.push(rec);
          break;
        }
      }
    }

    if (near.length) return { query, verdict: "partial", matches: near };

    // Последняя попытка: предмет может существовать под другим названием, но
    // упоминаться в чьём-нибудь описании. Так «Monowire» находится через
    // «Slice N Dice». Ищем только по осмысленно длинным словам, иначе предлоги
    // вытащат пол-индекса.
    const words = key.split(" ").filter((w) => w.length >= 5);
    const mentioned = words.length
      ? index.filter((rec) => {
          const text = normalize(rec.description);
          return text && words.some((w) => text.includes(w));
        })
      : [];

    return { query, verdict: "missing", matches: [], mentioned };
  });

  const groups = {
    exact: results.filter((r) => r.verdict === "exact"),
    partial: results.filter((r) => r.verdict === "partial"),
    missing: results.filter((r) => r.verdict === "missing"),
  };

  const describe = (rec) =>
    `${rec.name}${rec.nameRu ? ` / ${rec.nameRu}` : ""} — ${rec.type}` +
    `${rec.price !== null ? `, ${rec.price}eb` : ""} [${rec.packLabel}]`;

  console.log(`Позиций в материале: ${names.length}\n`);

  console.log(`=== ЕСТЬ (${groups.exact.length}) ===`);
  for (const r of groups.exact) {
    console.log(`  ${r.query}`);
    console.log(`      ${describe(r.matches[0])}`);
  }

  console.log(`\n=== ПОХОЖЕ, ПРОВЕРЬ ГЛАЗАМИ (${groups.partial.length}) ===`);
  for (const r of groups.partial) {
    console.log(`  ${r.query}`);
    for (const m of r.matches.slice(0, 4)) console.log(`      ${describe(m)}`);
    if (r.matches.length > 4) {
      console.log(`      ... и ещё ${r.matches.length - 4}`);
    }
  }

  console.log(`\n=== НЕТ, КАНДИДАТЫ В МОДУЛЬ (${groups.missing.length}) ===`);
  for (const r of groups.missing) {
    console.log(`  ${r.query}`);
    for (const m of (r.mentioned ?? []).slice(0, 3)) {
      console.log(`      упоминается в: ${describe(m)}`);
    }
  }

  const jsonFlag = rest.indexOf("--json");
  if (jsonFlag >= 0) {
    const outPath = rest[jsonFlag + 1] ?? "check-result.json";
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\nПодробности записаны: ${outPath}`);
  }
}

main();

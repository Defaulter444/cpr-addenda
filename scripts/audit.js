/**
 * Сверка материала с тем, что уже есть в мире.
 *
 * Прежде чем добавлять предмет, нужно убедиться, что его нет ни в системе, ни в
 * чужих модулях, ни в самом мире. Проверять глазами по девяти десяткам
 * компендиумов бессмысленно, поэтому здесь собирается единый индекс и по нему
 * идёт поиск: сперва точное совпадение, затем нормализованное (без регистра,
 * пунктуации и латиницы-в-скобках), затем — по вхождению.
 *
 * Отдельная сложность — двуязычие. Babele подменяет названия на русские прямо в
 * индексе компендиума, а оригинал прячет в `originalName`. Индексируем оба, так
 * что искать можно и по «Глушитель», и по «Silencer».
 */

/**
 * Приводит название к виду, пригодному для сравнения.
 *
 * @param {String} value - исходное название
 * @returns {String}
 */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'’`]/g, "")
    .replace(/[\s\-–—_.,:;()[\]]+/g, " ")
    .trim();
}

/**
 * Собирает индекс всех предметов из всех доступных компендиумов и из мира.
 *
 * @async
 * @param {Object} options
 *   @param {Boolean} options.includeWorld - включать ли предметы самого мира
 * @returns {Promise<Array<Object>>} - плоский список записей
 */
export async function buildPackIndex({ includeWorld = true } = {}) {
  const records = [];

  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;

    // Дополнительные поля нужны, чтобы отличать «есть, но другое» от «есть».
    const index = await pack.getIndex({
      fields: ["system.type", "system.price", "system.weaponType"],
    });

    for (const entry of index) {
      records.push({
        name: entry.name,
        originalName: entry.originalName ?? entry.name,
        type: entry.type,
        upgradeType: entry.system?.type ?? null,
        weaponType: entry.system?.weaponType ?? null,
        price: entry.system?.price?.market ?? null,
        pack: pack.collection,
        packLabel: pack.metadata.label,
        uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`,
      });
    }
  }

  if (includeWorld) {
    for (const item of game.items) {
      records.push({
        name: item.name,
        originalName: item.name,
        type: item.type,
        upgradeType: item.system?.type ?? null,
        weaponType: item.system?.weaponType ?? null,
        price: item.system?.price?.market ?? null,
        pack: "world",
        packLabel: game.i18n.localize("DOCUMENT.Items"),
        uuid: item.uuid,
      });
    }
  }

  return records;
}

/**
 * Ищет позиции материала среди уже имеющегося контента.
 *
 * @async
 * @param {Array<String>} names - названия из материала, на русском или английском
 * @param {Object} options
 *   @param {Array<Object>} options.index - готовый индекс, чтобы не пересобирать
 * @returns {Promise<Array<Object>>} - по записи на каждое название
 */
export async function findMatches(names, { index = null } = {}) {
  const records = index ?? (await buildPackIndex());

  // Один проход по индексу вместо прохода на каждое искомое название.
  const byExact = new Map();
  for (const rec of records) {
    for (const variant of [rec.name, rec.originalName]) {
      const key = normalize(variant);
      if (!key) continue;
      if (!byExact.has(key)) byExact.set(key, []);
      byExact.get(key).push(rec);
    }
  }

  return names.map((rawName) => {
    const key = normalize(rawName);
    const exact = byExact.get(key) ?? [];

    if (exact.length) {
      return { query: rawName, verdict: "exact", matches: exact };
    }

    // Частичное совпадение ловит расхождения перевода и уточнения в скобках:
    // «Глушитель (пистолетный)» против «Глушитель».
    const partial = records.filter((rec) => {
      const a = normalize(rec.name);
      const b = normalize(rec.originalName);
      return (
        (a && (a.includes(key) || key.includes(a))) ||
        (b && (b.includes(key) || key.includes(b)))
      );
    });

    if (partial.length) {
      return { query: rawName, verdict: "partial", matches: partial };
    }

    return { query: rawName, verdict: "missing", matches: [] };
  });
}

/**
 * Случайная шестёрка: план по роли и уровню угрозы.
 *
 * Мастеру дольше всего делать не столкновение, а НИП для него. Здесь он
 * называет три вещи — кого, насколько опасного и сколько железа, — а остальное
 * собирается само.
 *
 * ЧИСЛА ВЗЯТЫ ИЗ КНИГИ, НЕ ПРИДУМАНЫ.
 *
 * Наборы навыков по ролям — «Уличная крыса (шаблоны)», русское издание, с. 86-87.
 * Там для каждой роли перечислены и базовые навыки, и профессиональные, с
 * уровнями 2, 4 и 6. Их и берём: это официальный ответ на вопрос «что важно для
 * этой роли».
 *
 * Оружие и броня по ролям — там же, с. 98: «Как ты получаешь оружие и броню».
 *
 * Лесенка опасности — «Шестёрки и пушечное мясо», с. 414-418. У книги есть
 * готовые НИП от бустера (20 ПЗ, кожа ОС 4, пистолет низкого качества) до
 * киберпсиха (40 ПЗ, подкожная броня, выкидной гранатомёт). По ним и построены
 * четыре ступени.
 *
 * Оттуда же ответ на «чтобы шестёрка с РПГ не бегала»: в книге гранатомёт
 * появляется ровно у одного НИП, и это киберпсих — угроза уровня босса. Значит,
 * тяжёлое и экзотическое оружие открывается только на верхней ступени.
 *
 * Предметы ищутся по АНГЛИЙСКИМ названиям: в компендиумах они такие, а Babele
 * переводит только показ. Поиск по русскому названию промахивался бы.
 *
 * Здесь только план — обычный объект. Ничего не создаётся и Foundry не нужен,
 * поэтому весь расклад проверяется без запуска игры.
 */

/* ------------------------------------------------------------------ */
/*  Ступени опасности (с. 414-418)                                     */
/* ------------------------------------------------------------------ */

/**
 * Четыре ступени.
 *
 * `skillBonus` — насколько ступень поднимает профессиональные навыки роли.
 * `statBonus` — то же для приоритетных характеристик.
 * `quality` — качество оружия: у книжного бустера и телохранителя оно низкое.
 * `heavy` — можно ли выдавать тяжёлое и экзотическое.
 */
export const TIERS = {
  mook: {
    key: "mook",
    // Бустер: спасбросок 2, 20 ПЗ, кожа. Дорожный бандит: 3, 25 ПЗ, кожа.
    // Спасбросок в книге равен ТЕЛУ — по нему и выставлена полоса.
    body: [2, 3], will: [2, 3],
    armor: "Leathers",
    quality: "poor",
    skillBonus: 0, statBonus: 0,
    heavy: false, roleRank: 0,
  },
  lieutenant: {
    key: "lieutenant",
    // Сотрудник СБ: ТЕЛО 5, 30 ПЗ, кевлар ОС 7. Телохранитель: ТЕЛО 6, 35 ПЗ.
    body: [5, 6], will: [3, 4],
    armor: "Kevlar®",
    quality: "poor",
    skillBonus: 2, statBonus: 1,
    heavy: false, roleRank: 2,
  },
  miniboss: {
    key: "miniboss",
    // Шеф восстановителей: ТЕЛО 6, 40 ПЗ, лёгкий арморджек ОС 11.
    // Сопровождающий: ТЕЛО 5, 30 ПЗ, роль «Мото» рангом 4.
    body: [5, 6], will: [4, 6],
    armor: "Light Armorjack",
    quality: "standard",
    skillBonus: 4, statBonus: 2,
    heavy: false, roleRank: 4,
  },
  boss: {
    key: "boss",
    // Офицер СБ: ТЕЛО 7, 40 ПЗ, средний арморджек ОС 12.
    // Киберпсих: ТЕЛО 6, 40 ПЗ, и единственный в книге с гранатомётом.
    body: [6, 7], will: [5, 7],
    armor: "Medium Armorjack",
    quality: "excellent",
    skillBonus: 6, statBonus: 3,
    heavy: true, roleRank: 6,
  },
};

/** Порядок ступеней от слабой к сильной. */
export const TIER_ORDER = ["mook", "lieutenant", "miniboss", "boss"];

/* ------------------------------------------------------------------ */
/*  Роли (с. 86-87 и 98)                                               */
/* ------------------------------------------------------------------ */

/**
 * Базовые навыки, общие для всех ролей.
 *
 * В книге они выделены жирным и стоят у каждой роли; отличаются только уровни,
 * поэтому здесь общий список, а различия — в самой роли.
 */
const BASE_SKILLS = {
  Athletics: 2,
  Brawling: 2,
  Concentration: 2,
  Conversation: 2,
  Education: 2,
  Evasion: 6,
  "First Aid": 2,
  "Human Perception": 2,
  "Language (Streetslang)": 2,
  "Local Expert (Your Home)": 2,
  Perception: 2,
  Persuasion: 2,
  Stealth: 2,
};

/**
 * Роли: приоритетные характеристики, профессиональные навыки и стартовое железо.
 *
 * `skills` дополняют и перекрывают базовые. `stats` — что для роли важно; по
 * ним ступень и раздаёт прибавку. `weapons` и `armor` — со с. 98.
 */
export const ROLES = {
  none: {
    key: "none",
    stats: ["ref", "body"],
    skills: {
      Handgun: 6, "Melee Weapon": 4, Brawling: 4, Streetwise: 4,
    },
    weapons: ["Very Heavy Pistol", "Medium Pistol"],
    melee: "Combat Knife",
  },
  rockerboy: {
    key: "rockerboy",
    stats: ["cool", "emp", "dex"],
    skills: {
      Brawling: 6, Composition: 6, Handgun: 6, "Melee Weapon": 6,
      // В книге у рокербоя «Игра на инструменте (на выбор)», а в компендиуме
      // каждый инструмент — отдельный предмет: голого «Play Instrument» там
      // нет. Выбираем гитару: рокербой с гитарой — это ровно тот образ, ради
      // которого роль и берут в столкновение.
      "Personal Grooming": 4, "Play Instrument (Guitar)": 6, Streetwise: 6,
      "Wardrobe & Style": 4, Persuasion: 6, "Human Perception": 6,
      "First Aid": 6, "Local Expert (Your Home)": 4,
    },
    weapons: ["Very Heavy Pistol"],
    melee: "Heavy Melee",
  },
  solo: {
    key: "solo",
    stats: ["ref", "body", "dex"],
    skills: {
      Autofire: 6, Handgun: 6, Interrogation: 6, "Melee Weapon": 6,
      "Resist Torture/Drugs": 6, "Shoulder Arms": 6, Tactics: 6,
      Perception: 6, "First Aid": 6,
    },
    weapons: ["Assault Rifle", "Very Heavy Pistol"],
    melee: "Heavy Melee",
  },
  netrunner: {
    key: "netrunner",
    stats: ["int", "tech", "ref"],
    skills: {
      "Basic Tech": 6, "Conceal/Reveal Object": 6, Cryptography: 6,
      Cybertech: 6, "Electronics/Security Tech": 6, "Library Search": 6,
      Education: 6, Stealth: 6, "First Aid": 2,
    },
    weapons: ["Very Heavy Pistol"],
    melee: null,
  },
  tech: {
    key: "tech",
    stats: ["tech", "int"],
    skills: {
      "Basic Tech": 6, Cybertech: 6, "Electronics/Security Tech": 6,
      "Land Vehicle Tech": 6, "Shoulder Arms": 6, Weaponstech: 6,
      Education: 6, "First Aid": 6, "Science (Chemistry)": 6,
    },
    weapons: ["Shotgun", "Assault Rifle"],
    melee: null,
  },
  medtech: {
    key: "medtech",
    stats: ["tech", "int", "emp"],
    skills: {
      "Basic Tech": 6, Cybertech: 4, Deduction: 6, Paramedic: 6,
      "Resist Torture/Drugs": 4, "Science (Chemistry)": 6, "Shoulder Arms": 6,
      Education: 6, Conversation: 6, "Human Perception": 6,
    },
    weapons: ["Shotgun", "Assault Rifle"],
    melee: null,
  },
  media: {
    key: "media",
    stats: ["cool", "int", "emp"],
    skills: {
      Bribery: 6, Composition: 6, Deduction: 6, Handgun: 6,
      "Library Search": 4, "Lip Reading": 4, "Photography/Film": 4,
      Conversation: 6, "Human Perception": 6, "Local Expert (Your Home)": 6,
      Perception: 6, Persuasion: 6,
    },
    weapons: ["Very Heavy Pistol"],
    melee: null,
  },
  lawman: {
    key: "lawman",
    stats: ["ref", "cool", "will"],
    skills: {
      Autofire: 6, Criminology: 6, Deduction: 6, Handgun: 6,
      Interrogation: 6, "Shoulder Arms": 6, Tracking: 6,
      Brawling: 6, Conversation: 6,
    },
    weapons: ["Assault Rifle", "Very Heavy Pistol"],
    melee: "Medium Melee",
  },
  exec: {
    key: "exec",
    stats: ["cool", "int", "emp"],
    skills: {
      Accounting: 6, Bureaucracy: 6, Business: 6, Handgun: 6,
      Interrogation: 6, "Shoulder Arms": 6, Education: 6,
      Conversation: 6, "Human Perception": 6, Persuasion: 6,
    },
    weapons: ["Very Heavy Pistol"],
    melee: null,
  },
  fixer: {
    key: "fixer",
    stats: ["cool", "emp", "int"],
    skills: {
      Bribery: 6, Business: 6, Deduction: 6, Forgery: 6, Handgun: 6,
      "Lip Reading": 6, Streetwise: 6, Trading: 6,
      Conversation: 6, "Human Perception": 6, "Local Expert (Your Home)": 6,
      Persuasion: 4, "Language (Streetslang)": 4,
    },
    weapons: ["Very Heavy Pistol"],
    melee: null,
  },
  nomad: {
    key: "nomad",
    stats: ["ref", "tech", "body"],
    skills: {
      "Animal Handling": 6, Brawling: 6, "Drive Land Vehicle": 6, Handgun: 6,
      "Melee Weapon": 6, "Pick Lock": 4, Streetwise: 6, Tracking: 6,
      "Wilderness Survival": 6, "First Aid": 6, Stealth: 6, Perception: 4,
    },
    weapons: ["Very Heavy Pistol", "Shotgun"],
    melee: "Medium Melee",
  },
};

/** Порядок ролей для окна выбора. */
export const ROLE_ORDER = [
  "none", "solo", "netrunner", "tech", "medtech", "media",
  "lawman", "exec", "fixer", "nomad", "rockerboy",
];

/* ------------------------------------------------------------------ */
/*  Оружие по ступеням                                                 */
/* ------------------------------------------------------------------ */

/**
 * Что вообще разрешено на этой ступени.
 *
 * Тяжёлое и экзотическое — только боссу: в книге гранатомёт есть ровно у
 * киберпсиха, а он угроза верхнего уровня. Ради этого правила всё и затевалось.
 */
export const TIER_WEAPONS = {
  mook: ["medPistol", "heavyPistol", "vHeavyPistol", "smg", "shotgun", "bow"],
  lieutenant: ["medPistol", "heavyPistol", "vHeavyPistol", "smg", "shotgun", "assaultRifle"],
  miniboss: ["heavyPistol", "vHeavyPistol", "smg", "shotgun", "assaultRifle", "sniperRifle"],
  boss: [
    "heavyPistol", "vHeavyPistol", "smg", "shotgun",
    "assaultRifle", "sniperRifle", "grenadeLauncher", "rocketLauncher", "heavyWeapon",
  ],
};

/** Тяжёлое оружие: его нельзя давать никому, кроме босса. */
export const HEAVY_TYPES = ["grenadeLauncher", "rocketLauncher", "heavyWeapon"];

/* ------------------------------------------------------------------ */
/*  Киберимпланты                                                      */
/* ------------------------------------------------------------------ */

/**
 * Четыре степени оснащения.
 *
 * Каждая запись — ОПОРНЫЙ имплант и его опции. Опции важны не меньше самого
 * импланта: голая киберрука не делает ничего, весь смысл в том, что в неё
 * вставлено, а пустые киберглаза не дают даже ночного зрения. Раньше выдавались
 * только опорные, и на листе они выглядели как четыре пустых гнезда.
 *
 * Опции обязаны совпадать с опорным по виду (`system.type`): в киберруку
 * встаёт только то, что помечено `cyberArm`. Здесь это соблюдено.
 *
 * Названия предметов английские — такие они в компендиумах.
 */
export const CHROME = {
  none: { key: "none", parts: [] },
  minimal: {
    key: "minimal",
    parts: [
      { name: "Neural Link", options: ["Interface Plugs"] },
      { name: "Cyberaudio Suite", options: ["Amplified Hearing"] },
    ],
  },
  serious: {
    key: "serious",
    parts: [
      { name: "Neural Link", options: ["Interface Plugs", "Kerenzikov"] },
      { name: "Cyberaudio Suite", options: ["Amplified Hearing", "Radio Communicator"] },
      { name: "Cybereye", options: ["Low Light/IR/UV"] },
      { name: "Cybereye", options: ["Image Enhance"] },
      { name: "Subdermal Armor", options: [] },
      { name: "Grafted Muscle and Bone Lace", options: [] },
    ],
  },
  fullborg: {
    key: "fullborg",
    parts: [
      { name: "Neural Link", options: ["Interface Plugs", "Sandevistan"] },
      { name: "Cyberaudio Suite", options: ["Amplified Hearing", "Radio Communicator"] },
      { name: "Cybereye", options: ["Low Light/IR/UV"] },
      { name: "Cybereye", options: ["Targeting Scope"] },
      // Киберпсих из книги (с. 418) — с выкидным гранатомётом в руке. Рядовому
      // боргу его не даём: это оружие уровня босса, и правило про РПГ здесь
      // тоже действует. Руки получают когти и обычную кисть.
      { name: "Cyberarm", options: ["Rippers", "Standard Hand"] },
      { name: "Cyberarm", options: ["Standard Hand"] },
      { name: "Cyberleg", options: ["Standard Foot", "Jump Booster"] },
      { name: "Cyberleg", options: ["Standard Foot"] },
      { name: "Subdermal Armor", options: [] },
      { name: "Grafted Muscle and Bone Lace", options: [] },
    ],
  },
};

export const CHROME_ORDER = ["none", "minimal", "serious", "fullborg"];

/* ------------------------------------------------------------------ */
/*  Расклад                                                            */
/* ------------------------------------------------------------------ */

/** Целое число в отрезке, включая границы. */
function between(random, low, high) {
  return low + Math.floor(random() * (high - low + 1));
}

/** Случайный элемент списка. */
function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

/**
 * Характеристики шестёрки.
 *
 * У книжных НИП значения лежат между 2 и 8: приоритетные для роли — выше,
 * остальные — обычные. ТЕЛО и ВОЛЯ задаёт ступень: от них считаются очки
 * здоровья, а те у книжных образцов растут ровно со ступенью.
 *
 * @param {Function} random - источник случайности
 * @param {Object} role - роль
 * @param {Object} tier - ступень
 * @returns {Object} - характеристики
 */
export function rollStats(random, role, tier) {
  const stats = {};
  for (const key of ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"]) {
    stats[key] = between(random, 3, 5);
  }
  // У шестёрок из книги нет УДЧ, если не сказано иное (с. 414).
  stats.luck = 0;

  for (const key of role.stats) {
    stats[key] = Math.min(8, between(random, 5, 6) + tier.statBonus);
  }

  // ТЕЛО и ВОЛЯ задаёт СТУПЕНЬ, а не роль, и назначаются они последними.
  // Из них считаются очки здоровья, а те у книжных образцов растут ровно со
  // ступенью: бустер 20, телохранитель 35, шеф восстановителей 40. Если отдать
  // их роли, рядовая шестёрка соло получит боссовы 35 ПЗ и перестанет быть
  // рядовой — именно это и происходило.
  //
  // Роль всё же слышна: когда ТЕЛО или ВОЛЯ для неё приоритетны, берём верх
  // полосы ступени, а не середину.
  const band = (key, low, high) =>
    (role.stats.includes(key) ? high : between(random, low, high));
  stats.body = band("body", tier.body[0], tier.body[1]);
  stats.will = band("will", tier.will[0], tier.will[1]);
  return stats;
}

/**
 * Очки здоровья по книге: 10 + 5 × округлённое вверх среднее ТЕЛА и ВОЛИ.
 *
 * Сходится с образцами: ТЕЛО 6 и ВОЛЯ 4 дают 35 — ровно как у телохранителя.
 *
 * @param {Object} stats - характеристики
 * @returns {Number}
 */
export function hitPoints(stats) {
  return 10 + 5 * Math.ceil((stats.body + stats.will) / 2);
}

/**
 * Навыки: базовые плюс профессиональные роли, поднятые ступенью.
 *
 * Ступень поднимает только профессиональные: у книжных НИП разница между
 * бустером и офицером СБ именно в них, а не в умении плавать.
 *
 * @param {Object} role - роль
 * @param {Object} tier - ступень
 * @returns {Object} - название навыка -> уровень
 */
export function skillLevels(role, tier) {
  const levels = { ...BASE_SKILLS };
  for (const [name, value] of Object.entries(role.skills)) {
    const professional = !(name in BASE_SKILLS) || value > (BASE_SKILLS[name] ?? 0);
    levels[name] = professional ? Math.min(10, value + tier.skillBonus) : value;
  }
  return levels;
}

/**
 * Оружие: подходящее роли и разрешённое ступенью.
 *
 * Роль называет, чем она воюет, ступень — что ей вообще позволено. Пересечение
 * и берём; если роль просит того, чего ступень не даёт, остаётся пистолет.
 *
 * @param {Function} random - источник случайности
 * @param {Object} role - роль
 * @param {Object} tier - ступень
 * @param {Array} catalogue - доступное оружие: {name, type}
 * @returns {Array<Object>} - выбранное оружие
 */
export function chooseWeapons(random, role, tier, catalogue) {
  const allowed = new Set(TIER_WEAPONS[tier.key]);
  const byName = new Map(catalogue.map((item) => [item.name, item]));

  const chosen = [];
  for (const name of role.weapons) {
    const item = byName.get(name);
    if (item && allowed.has(item.type)) chosen.push(item);
  }

  // Роль осталась без оружия — значит, ступень не пустила её любимое.
  // Пистолет есть у каждого книжного НИП, им и закрываем.
  if (!chosen.length) {
    const fallback = catalogue.filter(
      (item) => allowed.has(item.type) && item.type.toLowerCase().includes("pistol")
    );
    if (fallback.length) chosen.push(pick(random, fallback));
  }

  if (role.melee) {
    const melee = byName.get(role.melee);
    if (melee) chosen.push(melee);
  }
  return chosen;
}

/**
 * Полный расклад шестёрки — обычный объект, ничего не создающий.
 *
 * @param {Object} options - {role, tier, chrome, random, catalogue, name}
 * @returns {Object} - расклад
 */
export function planMook({ role, tier, chrome, random = Math.random, catalogue = [], name = "" }) {
  const roleData = ROLES[role] ?? ROLES.none;
  const tierData = TIERS[tier] ?? TIERS.mook;
  const chromeData = CHROME[chrome] ?? CHROME.none;

  const stats = rollStats(random, roleData, tierData);
  return {
    name,
    role: roleData.key,
    tier: tierData.key,
    chrome: chromeData.key,
    stats,
    hp: hitPoints(stats),
    skills: skillLevels(roleData, tierData),
    weapons: chooseWeapons(random, roleData, tierData, catalogue),
    armor: tierData.armor,
    quality: tierData.quality,
    cyberware: chromeData.parts.map((part) => ({ ...part, options: [...part.options] })),
    // Роль на листе появляется только у сколько-нибудь серьёзной угрозы: у
    // книжных шестёрок ролей нет вовсе (с. 414).
    roleRank: roleData.key === "none" ? 0 : tierData.roleRank,
  };
}

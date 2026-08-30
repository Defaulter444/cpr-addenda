# -*- coding: utf-8 -*-
"""
Собирает исходники силовой брони из данных Data Pool.

Силовая броня — единственная система в книгах, которая не ложится ни на один
тип предмета Cyberpunk RED: у неё свои очки прочности, своя броня, свой пилот
и своё бортовое оружие. Ближайший родственник ей — не куртка и не ствол, а
транспорт, поэтому готовые комплекты собираются актёрами под лист транспорта
модуля, а компоненты конструктора остаются обычным снаряжением.

Числа перенесены из документа дословно и проверяются пересчётом: каждый из
десяти готовых комплектов должен собираться конструктором (экзоскелет +
оболочка + четыре настройки). Проверка выполняется при каждом запуске, и без
неё файлы не пишутся.

    python tools/import_power_armor.py

После — `node tools/build-packs.js` при закрытом Foundry.
"""

import io
import itertools
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "sources")
SOURCE_REF = {"book": "DataPool", "page": 0}
GEAR_ICON = "modules/cpr-addenda/assets/icons/gear.svg"
ARMOR_ICON = "modules/cpr-addenda/assets/icons/armor.svg"

# Картинки костюмов. Мастер кладёт сюда файл с именем, совпадающим с именем
# исходника костюма (zhirafa-boris.webp), и следующая сборка подхватит его
# сама. Отдельная картинка для токена — с приставкой «-token».
#
# Так, а не правкой актёра в игре: правка живёт до первой пересборки пака,
# а файл в assets переживает и пересборку, и обновление модуля.
ART_DIR_NAME = "power-armor"
ART_EXTENSIONS = ("webp", "png", "jpg", "jpeg", "avif", "gif", "svg")
MODULE_ID = "cpr-addenda"
# Те же имена, что в scripts/constants.js — VEHICLE_FLAGS.
VEHICLE_MOUNT = "vehicleMountedPosition"
VEHICLE_INSTALLED = "vehicleInstalled"

# ---------------------------------------------------------------------------
#  Данные документа
# ---------------------------------------------------------------------------

# Экзоскелет: имя, цена, категория, ТЕЛО, ПЗ, модификаторы пилота.
EXOSKELETONS = [
    ("Мародёрский", 1000, "Очень дорогое", 10, 14, {}),
    ("Сигма", 2000, "Роскошь", 12, 22, {"move": +1}),
    ("Бета", 10000, "Супер роскошь", 14, 27, {"move": +2}),
    ("Омега", 20000, "Супер роскошь", 16, 32, {"move": +3}),
]

# Оболочка: имя, цена, категория, ОС, прибавка к ПЗ, модификаторы пилота.
SHELLS = [
    ("Мародёрская", 1000, "Очень дорогое", 14, +2, {"move": -1}),
    ("Лёгкий Metalgear®", 2000, "Роскошь", 16, +3, {}),
    ("Гибридный Metalgear®", 5124, "Роскошь", 17, +10, {"move": -1}),
    ("Metalgear®", 10000, "Супер роскошь", 18, +17, {"move": -3}),
    ("Тяжёлый Metalgear®", 10000, "Супер роскошь", 19, +21, {"move": -4}),
]

# Настройки конструктора: имя, пояснение, опция А, опция B.
#
# В таблице источника четвёртая настройка подписана «Манёвренность» второй раз,
# хотя вводный текст перечисляет «манёвренность, гидравлика, ускорение и масса».
# Четвёртая — Масса; подпись в таблице считаем опечаткой вёрстки.
TUNING = [
    ("Ускорение",
     "За счёт снижения массы силовая броня быстрее выходит на пиковую "
     "манёвренность, чем в стандартной конфигурации.",
     ("−7 ПЗ", {"hp": -7}), ("−1 ЛВК", {"dex": -1})),
    ("Гидравлика",
     "Дополнительная защита гидравлики силовой брони достигается ценой потери "
     "полной амплитуды движений.",
     ("−1 ОС", {"sp": -1}), ("−1 СКО", {"move": -1})),
    ("Манёвренность",
     "За счёт облегчённых ног силовой брони пилот может легче «скручивать» "
     "костюм на высоких скоростях.",
     ("−7 ПЗ", {"hp": -7}), ("−1 РЕФ", {"ref": -1})),
    ("Масса",
     "Внутреннее пространство силовой брони содержит сегменты, которые, по "
     "мнению некоторых пилотов, не критичны для боевой эффективности.",
     ("+7 ПЗ", {"hp": +7}), ("+1 СКО", {"move": +1})),
]

STAT_RU = {"ref": "РЕФ", "dex": "ЛВК", "move": "СКО"}

DATA = json.load(io.open(
    os.path.join(ROOT, "docs", "power-armor.json"), encoding="utf-8"
))
SUITS = DATA["suits"]

# Бортовые предметы, извлечённые из компендиумов системы.
# Собирается `node tools/extract-pa-items.js`; там же выверено соответствие
# «как названо в Data Pool» -> «как называется в компендиуме».
ITEMS_PATH = os.path.join(ROOT, "docs", "power-armor-items.json")
ONBOARD = (
    json.load(io.open(ITEMS_PATH, encoding="utf-8"))
    if os.path.exists(ITEMS_PATH)
    else {}
)

# Оружие, которого нет в компендиумах: характеристики из Data Pool.
WEAPONS_PATH = os.path.join(ROOT, "docs", "power-armor-weapons.json")
DP_WEAPONS = (
    json.load(io.open(WEAPONS_PATH, encoding="utf-8"))["weapons"]
    if os.path.exists(WEAPONS_PATH)
    else []
)


# ---------------------------------------------------------------------------
#  Проверка данных
# ---------------------------------------------------------------------------

def assemble(exo_name, shell_name, choices):
    """Собирает броню конструктором: экзоскелет + оболочка + четыре настройки."""
    exo = next(e for e in EXOSKELETONS if e[0] == exo_name)
    shell = next(s for s in SHELLS if s[0] == shell_name)

    hp = exo[4] + shell[4]
    sp = shell[3]
    stats = {}
    for key, value in list(exo[5].items()) + list(shell[5].items()):
        stats[key] = stats.get(key, 0) + value

    for tuning, pick in zip(TUNING, choices):
        _, effect = tuning[2] if pick == "A" else tuning[3]
        for key, value in effect.items():
            if key == "hp":
                hp += value
            elif key == "sp":
                sp += value
            else:
                stats[key] = stats.get(key, 0) + value

    return hp, sp, exo[3], {k: v for k, v in stats.items() if v}


def verify(suits):
    """Каждый готовый комплект обязан собираться конструктором."""
    problems = []
    for suit in suits:
        ok = False
        for choices in itertools.product("AB", repeat=4):
            hp, sp, body, mods = assemble(suit["exo"], suit["shell"], choices)
            if (hp, sp, mods) == (suit["hp"], suit["sp"], suit["mods"]):
                ok = True
                break
        exo_body = next(e for e in EXOSKELETONS if e[0] == suit["exo"])[3]
        if not ok:
            problems.append(
                f"{suit['name']}: заявленные {suit['hp']} ПЗ / {suit['sp']} ОС "
                f"не собираются из «{suit['exo']}» и «{suit['shell']}»"
            )
        if exo_body != suit["body"]:
            problems.append(
                f"{suit['name']}: ТЕЛО {suit['body']}, а экзоскелет "
                f"«{suit['exo']}» даёт {exo_body}"
            )
    return problems


# ---------------------------------------------------------------------------
#  Вспомогательное
# ---------------------------------------------------------------------------

TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slug(name):
    """Имя файла исходника: латиницей, через дефис — как у остальных."""
    out = "".join(TRANSLIT.get(ch, ch) for ch in name.lower())
    out = re.sub(r"[^a-z0-9]+", "-", out)
    return out.strip("-")


def mods_text(mods):
    """«−1 ЛВК, +1 СКО» — как это написано в документе."""
    if not mods:
        return "без модификаторов"
    return ", ".join(
        f"{'+' if v > 0 else '−'}{abs(v)} {STAT_RU[k]}" for k, v in mods.items()
    )


# Внутренние ключи характеристик системы. Они же — английские сокращения на
# листе, поэтому годятся как есть.
STAT_KEY = {"ref": "REF", "dex": "DEX", "move": "MOVE"}


def stat_mods_field(mods):
    """Строка модификаторов для поста листа транспорта: «DEX:-1, MOVE:+1».

    Пишем внутренними ключами, а не русскими сокращениями. Лист принимает и
    «ЛВК:-1», но только когда включена русификация системы: словарь сокращений
    он строит из её переводов. В мире с английским интерфейсом русская запись
    не разобралась бы, и модификатор поста молча не применился бы — а такое в
    бою не заметить. Английская запись работает при любом языке.
    """
    return ", ".join(f"{STAT_KEY[k]}:{v:+d}" for k, v in mods.items())


def artwork(name_slug, suffix=""):
    """Путь к картинке костюма, если она положена в assets/power-armor.

    Расширения перебираются в порядке предпочтения: webp легче всех и Foundry
    его любит, svg идёт последним — он хорош для значков, но не для портрета.

    @param {str} name_slug - имя костюма латиницей, как у файла исходника
    @param {str} suffix - «-token» для отдельной картинки токена
    @returns {str|None} - путь для Foundry или None, если файла нет
    """
    directory = os.path.join(ROOT, "assets", ART_DIR_NAME)
    for extension in ART_EXTENSIONS:
        filename = f"{name_slug}{suffix}.{extension}"
        if os.path.exists(os.path.join(directory, filename)):
            return f"modules/{MODULE_ID}/assets/{ART_DIR_NAME}/{filename}"
    return None


def write(folder, filename, doc):
    directory = os.path.join(SOURCES, folder)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, filename)
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    )
    return path


def gear(doc_id, name, price, description):
    """Предмет-снаряжение в том виде, в каком его ждёт система."""
    return {
        "_id": doc_id,
        "name": name,
        "type": "gear",
        "img": GEAR_ICON,
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": {},
        "system": {
            "amount": 1,
            "brand": "",
            "concealable": {"concealable": False, "isConcealed": False},
            "description": {"value": description},
            "equipped": "owned",
            "favorite": False,
            "installedItems": {
                "allowed": False,
                "allowedTypes": ["itemUpgrade"],
                "list": [],
                "slots": 0,
                "usedSlots": 0,
            },
            "isElectronic": False,
            "price": {"market": price},
            "providesHardening": False,
            "revealed": True,
            "source": dict(SOURCE_REF),
            "usage": "toggled",
        },
    }


# ---------------------------------------------------------------------------
#  Компоненты конструктора
# ---------------------------------------------------------------------------

def make_components():
    """Экзоскелеты и оболочки — обычное снаряжение с ценой из документа.

    Имена с приставкой «Экзоскелет:» и «Оболочка:» намеренно: в системе уже
    есть личные линейные рамы под теми же названиями («Экзоскелет Сигма»), и
    стоят они вдвое дешевле. Это разные предметы, и путать их нельзя.
    """
    written = []

    for index, (name, price, category, body, hp, mods) in enumerate(EXOSKELETONS):
        doc_id = f"cprAddPa{index + 1:04d}0000"
        description = (
            "<p>Компонент силовой брони: ядро, вокруг которого она строится.</p>"
            f"<p><strong>ТЕЛО {body} • {hp} ПЗ • {mods_text(mods)}</strong><br>"
            f"Цена: {price:,}eb ({category})</p>".replace(",", " ")
            + "<p>Увеличение ТЕЛО не влияет на ПЗ и не изменяет спасброски от "
            "смерти. Если у пользователя установлен более мощный экзоскелет, чем "
            "тот, что используется в силовой броне, его ТЕЛО остаётся на более "
            "высоком значении. Руки силовой брони считаются киберруками при "
            "нанесении урона укрытиям, а ноги силовой брони считаются "
            "киберногами при падении.</p>"
            "<p><em>Это компонент для сборки силовой брони, а не личная линейная "
            "рама: у одноимённой персональной рамы своя цена и свои правила.</em></p>"
        )
        doc = gear(doc_id, f"Экзоскелет: {name}", price, description)
        written.append(write("addenda-gear", f"ekzoskelet-{slug(name)}.json", doc))

    for index, (name, price, category, sp, hp_bonus, mods) in enumerate(SHELLS):
        doc_id = f"cprAddPa{index + 11:04d}0000"
        description = (
            "<p>Компонент силовой брони: бронеплиты, в которые заключён "
            "экзоскелет.</p>"
            f"<p><strong>{sp} ОС • {hp_bonus:+d} ПЗ • {mods_text(mods)}</strong><br>"
            f"Цена: {price:,}eb ({category})</p>".replace(",", " ")
            + "<p>Находясь внутри силовой брони, пилот плотно заключён в "
            "оболочку, полностью изолированную от внешних атак.</p>"
        )
        doc = gear(doc_id, f"Оболочка: {name}", price, description)
        written.append(write("addenda-gear", f"obolochka-{slug(name)}.json", doc))

    return written


# ---------------------------------------------------------------------------
#  Справочник правил
# ---------------------------------------------------------------------------

def tuning_table():
    """Таблица настроек конструктора."""
    rows = "".join(
        f"<tr><td><strong>{name}</strong><br><em>{text}</em></td>"
        f"<td>{a[0]}</td><td>{b[0]}</td></tr>"
        for name, text, a, b in TUNING
    )
    return (
        "<h3>3. Настрой свою силовую броню</h3>"
        "<p>Для каждого параметра обязательно выбрать опцию А или опцию B.</p>"
        "<table><thead><tr><th>Настройка</th><th>Опция А</th><th>Опция B</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def components_tables():
    """Таблицы экзоскелетов и оболочек — шаги 1 и 2 сборки."""
    exo_rows = "".join(
        f"<tr><td>{n}</td><td>{p:,}eb ({c})</td><td>ТЕЛО {b}</td>"
        f"<td>{hp} ПЗ</td><td>{mods_text(m)}</td></tr>".replace(",", " ")
        for n, p, c, b, hp, m in EXOSKELETONS
    )
    shell_rows = "".join(
        f"<tr><td>{n}</td><td>{p:,}eb ({c})</td><td>{sp} ОС</td>"
        f"<td>{hb:+d} ПЗ</td><td>{mods_text(m)}</td></tr>".replace(",", " ")
        for n, p, c, sp, hb, m in SHELLS
    )
    return (
        "<h3>1. Выбери экзоскелет</h3>"
        "<table><thead><tr><th>Экзоскелет</th><th>Цена</th><th>ТЕЛО</th>"
        f"<th>ПЗ</th><th>Бонус/штраф</th></tr></thead><tbody>{exo_rows}</tbody></table>"
        "<h3>2. Выбери оболочку</h3>"
        "<table><thead><tr><th>Оболочка</th><th>Цена</th><th>ОС</th>"
        f"<th>ПЗ</th><th>Бонус/штраф</th></tr></thead><tbody>{shell_rows}</tbody></table>"
    )


def suits_table():
    """Сводка десяти готовых комплектов."""
    rows = ""
    for suit in SUITS:
        rows += (
            f"<tr><td><strong>{suit['name']}</strong></td>"
            f"<td>{suit['price']:,}eb<br>({suit['category']})</td>"
            f"<td>{suit['hp']} ПЗ<br>{suit['sp']} ОС</td>"
            f"<td>ТЕЛО {suit['body']}<br>{mods_text(suit['mods'])}</td>"
            f"<td>{suit['exo']}<br>{suit['shell']}</td></tr>"
        ).replace(",", " ")
    return (
        "<table><thead><tr><th>Комплект</th><th>Цена</th><th>Прочность</th>"
        "<th>Характеристики</th><th>Состав</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
        "<p>Каждый комплект есть в компендиуме «Addenda: Силовая броня» готовым "
        "актёром: откройте его листом транспорта, посадите пилота на пост — и "
        "модификаторы характеристик применятся сами.</p>"
    )


def page(page_id, name, content, sort):
    return {
        "_id": page_id,
        "name": name,
        "type": "text",
        "title": {"show": True, "level": 1},
        "image": {},
        "text": {"content": content, "format": 1},
        "video": {"controls": True, "volume": 0.5},
        "src": None,
        "system": {},
        "sort": sort,
        "ownership": {"default": -1},
        "flags": {},
    }


def make_journal():
    """Справочник правил силовой брони — пять страниц, как разделы источника."""
    rules = DATA["rules"]
    pages = [
        page("cprAddJp00020001", "Силовая броня", rules["intro"], 100000),
        page("cprAddJp00020002", "Правила использования", rules["usage"], 200000),
        page("cprAddJp00020003", "Строение силовой брони", rules["structure"], 300000),
        page("cprAddJp00020004", "Бой в силовой броне", rules["combat"], 400000),
        page("cprAddJp00020005", "Ремонт и сборка",
             rules["repair"] + components_tables() + tuning_table()
             + "<h3>4. Выбери бортовое оружие (до 6) и киберимпланты (до 6)</h3>"
             + rules["tuningNote"], 500000),
        page("cprAddJp00020006", "Готовые варианты", suits_table(), 600000),
    ]
    doc = {
        "_id": "cprAddJn00020000",
        "name": "Силовая броня — правила и конструктор",
        "folder": None,
        "sort": 0,
        "ownership": {"default": 0},
        "flags": {},
        "pages": pages,
    }
    return [write("addenda-journals", "silovaya-bronya.json", doc)]


# ---------------------------------------------------------------------------
#  Готовые комплекты — актёры под лист транспорта
# ---------------------------------------------------------------------------

def build_weapon(spec, doc_id):
    """Собирает ствол Data Pool на основе системного оружия того же класса.

    Заготовка нужна ради того, чего документ не задаёт: боеприпасов, иконки и
    списка приспособлений, которые в такой ствол вообще вставляются. Всё, что
    документ задаёт, переписывается поверх.
    """
    base = ONBOARD.get(spec["base"])
    if not base:
        raise SystemExit(
            f"нет заготовки «{spec['base']}» — запустите node tools/extract-pa-items.js"
        )

    doc = json.loads(json.dumps(base["doc"]))
    doc["_id"] = doc_id
    doc["name"] = spec["name"]
    doc["folder"] = None
    doc["sort"] = 0
    doc.pop("_stats", None)
    doc["flags"] = {}
    doc["ownership"] = {"default": 0}

    system = doc["system"]
    system["weaponType"] = spec["weaponType"]
    system["quality"] = spec["quality"]
    system["weaponSkill"] = spec["weaponSkill"]
    system["damage"] = spec["damage"]
    system["rof"] = spec["rof"]
    system["handsReq"] = spec["handsReq"]
    system["concealable"] = {
        "concealable": bool(spec["concealable"]),
        "isConcealed": False,
    }
    system["fireModes"] = {
        "autoFire": spec["autoFire"],
        "suppressiveFire": bool(spec["suppressiveFire"]),
    }
    system["magazine"] = {
        "ammoData": None,
        "max": spec["magazine"],
        "value": spec["magazine"],
    }
    system["price"] = {"market": spec["price"]}
    system["source"] = dict(SOURCE_REF)
    if spec.get("dvTable"):
        system["dvTable"] = spec["dvTable"]
    if spec.get("slots") is not None:
        system.setdefault("installedItems", {})
        system["installedItems"]["slots"] = spec["slots"]
        system["installedItems"]["usedSlots"] = 0
        system["installedItems"]["list"] = []
    # Единственное правило, которое система выражает полем, а не текстом.
    if spec.get("canIgnoreArmor"):
        system["canIgnoreArmor"] = True
        system["ignoreBelowSP"] = spec["ignoreBelowSP"]

    system["description"]["value"] = (
        f"<p>{spec['text']}</p>"
        f"<p><strong>Классификация:</strong> {spec['classification']}<br>"
        f"<strong>Навык одиночного выстрела:</strong> {spec['skillRu']}<br>"
        f"<strong>Таблица дальности:</strong> {spec['dvRu']}<br>"
        f"<strong>Особые режимы огня:</strong> {spec['fireRu']}<br>"
        f"<strong>Приспособления:</strong> {spec['attachments']}</p>"
        f"<p><strong>Особые свойства:</strong> {spec['special']}</p>"
        f"<p><strong>Цена:</strong> {spec['price']:,}eb ({spec['priceCategory']})</p>".replace(",", " ")
    )
    return doc


def make_weapons():
    """Оружие Data Pool отдельными предметами — его можно и купить, и выдать."""
    written = []
    for index, spec in enumerate(DP_WEAPONS):
        doc = build_weapon(spec, f"cprAddWp{index + 1:04d}0000")
        written.append(write("addenda-weapons", f"{slug(spec['name'])}.json", doc))
    return written


def embed(source, doc_id, flags):
    """Копия предмета из компендиума, готовая лечь внутрь актёра.

    Служебные поля пересобираем: `_id` должен быть свой, папка и сортировка
    компендиума внутри актёра не значат ничего, а `_stats` Foundry проставит
    сам при следующей записи.

    @param {dict} source - документ предмета из компендиума
    @param {str} doc_id - новый идентификатор, 16 символов
    @param {dict} flags - флаги модуля, привязывающие предмет к костюму
    """
    doc = json.loads(json.dumps(source))
    doc["_id"] = doc_id
    doc["folder"] = None
    doc["sort"] = 0
    doc.pop("_stats", None)
    doc.setdefault("flags", {})
    doc["flags"].pop("core", None)
    doc["flags"][MODULE_ID] = flags

    system = doc.setdefault("system", {})
    if doc.get("type") == "weapon":
        # Бортовое оружие всегда в работе: по правилам его нельзя разоружить,
        # а система считает неиспользуемое оружие лежащим в рюкзаке.
        system["equipped"] = "equipped"
        # Из компендиума оружие приезжает с пустым магазином — стрелять из
        # такого система не даст. Бортовое оружие приходит снаряжённым.
        magazine = system.get("magazine")
        if isinstance(magazine, dict) and magazine.get("max"):
            magazine["value"] = magazine["max"]
    return doc


def armor_plates(suit, number):
    """Бронеплиты костюма настоящим предметом брони.

    ОС костюма нельзя держать одним числом в шапке листа. Урон в системе
    считает `_applyDamage`, а он спрашивает у актёра `getEquippedArmors` —
    то есть надетые предметы брони, и берёт ОС именно у них. Без предмета
    броня показывалась в шапке, но при попадании не вычиталась ничего:
    костюм получал полный урон, как голый человек.

    Плиты закрывают и тело, и голову: пилот заключён в оболочку целиком, и
    правила не делят её ОС по зонам. Штраф здесь нулевой — штрафы костюма
    выдаются постом «Пилот» через модификаторы характеристик, и дублировать
    их в предмете значило бы вычесть их дважды.

    @param {dict} suit - готовый комплект
    @param {int} number - номер костюма, из него собирается идентификатор
    @returns {dict} - предмет брони, готовый лечь внутрь актёра
    """
    sp = int(suit["sp"])
    return {
        "_id": f"cprAddPi{number:02d}000000",
        "name": f"Бронеплиты: {suit['shell']}",
        "type": "armor",
        "img": ARMOR_ICON,
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": {MODULE_ID: {VEHICLE_INSTALLED: True}},
        "system": {
            "description": {
                "value": (
                    f"<p>Бронеплиты оболочки «{suit['shell']}»: ОС {sp}.</p>"
                    "<p>Когда физическая атака извне должна была бы нанести урон "
                    "пилоту, урон получает силовая броня, снижая свои ПЗ и ОС "
                    "вместо показателей человека внутри. Надетая на пилота броня "
                    "при этом ОС не теряет.</p>"
                    "<p>Боевые искусства и специальные приёмы не уменьшают ОС "
                    "силовой брони вдвое. При успешном ремонте костюма ОС "
                    "восстанавливается до максимума.</p>"
                )
            },
            "equipped": "equipped",
            "favorite": False,
            "isBodyLocation": True,
            "isHeadLocation": True,
            "isShield": False,
            "bodyLocation": {"sp": sp, "ablation": 0},
            "headLocation": {"sp": sp, "ablation": 0},
            "penalty": 0,
            "price": {"market": 0},
            "revealed": True,
            "source": dict(SOURCE_REF),
        },
    }


def onboard_items(suit, number, position_id):
    """Бортовое оружие и импланты костюма настоящими предметами.

    Оружие закрепляется за постом «Пилот»: по правилам бортовое оружие не
    требует рук и его нельзя разоружить, а лист как раз так и обращается с
    закреплённым за постом стволом. Импланты и бронеплиты помечаются
    установленными — на листе они уходят во вкладку «Улучшения».

    Возвращает предметы и список того, чего в компендиумах не нашлось.
    """
    # Броня идёт первой и с нулевым номером в последовательности: оружие и
    # импланты нумеруются с единицы, так что столкнуться они не могут.
    items = [armor_plates(suit, number)]
    unmatched = []
    sequence = 0

    # Ствол ищем сперва среди системных, потом среди собранных из Data Pool.
    own = {spec["key"]: index for index, spec in enumerate(DP_WEAPONS)}

    for name, count in suit["weapons"]:
        entry = ONBOARD.get(name)
        source_doc = entry["doc"] if entry else None
        if source_doc is None and name in own:
            source_doc = build_weapon(
                DP_WEAPONS[own[name]], f"cprAddWp{own[name] + 1:04d}0000"
            )
        if source_doc is None:
            unmatched.append(name if count == 1 else f"{name} (×{count})")
            continue
        for _ in range(count):
            sequence += 1
            items.append(embed(
                source_doc,
                f"cprAddPi{number:02d}{sequence:02d}0000",
                {VEHICLE_MOUNT: position_id},
            ))

    for name in suit["cyberware"]:
        entry = ONBOARD.get(name)
        if not entry:
            unmatched.append(name)
            continue
        sequence += 1
        items.append(embed(
            entry["doc"],
            f"cprAddPi{number:02d}{sequence:02d}0000",
            {VEHICLE_INSTALLED: True},
        ))

    return items, unmatched


def suit_description(suit, unmatched):
    """Описание для вкладки «Сведения» листа транспорта."""
    def listing(values):
        return "".join(f"<li>{v}</li>" for v in values) or "<li>нет</li>"

    weapons = [
        name if count == 1 else f"{name} (×{count})"
        for name, count in suit["weapons"]
    ]

    note = ""
    if unmatched:
        note = (
            "<p><em>Предметом не вложено: "
            + ", ".join(unmatched)
            + ". Такой позиции нет ни в компендиумах системы, ни отдельным "
            "предметом в Data Pool — она встречается только внутри готовых "
            "комплектов. Держите в уме как свойство костюма.</em></p>"
        )

    return (
        f"<p><strong>{suit['price']:,}eb ({suit['category']})</strong></p>".replace(",", " ")
        + f"<p>{suit['text']}</p>"
        + f"<p><strong>{suit['hp']} ПЗ • {suit['sp']} ОС • ТЕЛО {suit['body']}"
        + (f" • {mods_text(suit['mods'])}" if suit["mods"] else "")
        + "</strong></p>"
        + f"<p>Экзоскелет: {suit['exo']}<br>Оболочка: {suit['shell']}</p>"
        + f"<p><strong>Бортовое оружие</strong></p><ul>{listing(weapons)}</ul>"
        + f"<p><strong>Бортовые киберимпланты</strong></p><ul>{listing(suit['cyberware'])}</ul>"
        + note
        + "<p><em>ТЕЛО экзоскелета не поднимается эффектом поста: по правилам "
        "пилот берёт большее из своего ТЕЛО и ТЕЛО брони, а такое сравнение "
        "модификатором не выражается. Значение стоит на самом костюме.</em></p>"
    )


def make_actors():
    """Десять готовых комплектов как актёры, открывающиеся листом транспорта."""
    written = []
    embedded_total = 0
    with_art = 0
    for index, suit in enumerate(SUITS):
        number = index + 1
        name_slug = slug(suit["name"])
        portrait = artwork(name_slug)
        if portrait:
            with_art += 1
        # Токен по умолчанию тот же, что портрет: у костюма это одна и та же
        # железка, и заводить две картинки ради одинакового вида ни к чему.
        token_art = artwork(name_slug, "-token") or portrait or GEAR_ICON
        position_id = f"cprAddPos{number:07d}"
        items, unmatched = onboard_items(suit, number, position_id)
        embedded_total += len(items)

        position = {
            "id": position_id,
            "name": "Пилот",
            "order": 1,
            "occupants": [],
            # Навыки пилот бросает свои; какие именно — зависит от оружия,
            # поэтому строку оставляем мастеру.
            "skills": "",
            "statMods": stat_mods_field(suit["mods"]),
            "maxOccupants": 1,
            "canControlWeapons": True,
            "grantsTokenControl": True,
            "matchVehicleMove": False,
            "matchOccupantMove": False,
            "bulletproofGlass": False,
            "glassHp": 0,
            "glassHpMax": 0,
        }

        doc = {
            "_id": f"cprAddAc{number:04d}0000",
            "name": suit["name"],
            "type": "character",
            "img": portrait or GEAR_ICON,
            "folder": None,
            "sort": 0,
            "items": items,
            "effects": [],
            "ownership": {"default": 0},
            "flags": {
                # Лист выбирается заранее: иначе костюм открылся бы обычным
                # листом персонажа, и мастеру пришлось бы переключать вручную.
                "core": {"sheetClass": "cpr-addenda.VehicleSheet"},
                "cpr-addenda": {"vehiclePositions": [position]},
            },
            "system": {
                # ПЗ костюма — это ПЗТ в шапке листа транспорта.
                "derivedStats": {"hp": {"value": suit["hp"], "max": suit["hp"]}},
                # ОС Metalgear® — графа ОС корпуса.
                "externalData": {
                    "currentArmorBody": {"value": suit["sp"], "max": suit["sp"]}
                },
                "stats": {"body": {"value": suit["body"]}},
                "information": {
                    "alias": f"{suit['exo']} / {suit['shell']}",
                    "description": suit_description(suit, unmatched),
                    "notes": "",
                },
            },
            "prototypeToken": {
                "name": suit["name"],
                "texture": {"src": token_art},
                # Костюм — вещь именная: у каждого свои ПЗ, и общий счётчик на
                # два токена был бы неверен.
                "actorLink": True,
                "disposition": 0,
            },
        }
        written.append(write("addenda-actors", f"{name_slug}.json", doc))
    print(f"Вложено бортовых предметов: {embedded_total}")
    print(f"Костюмов со своей картинкой: {with_art} из {len(SUITS)}")
    return written


# ---------------------------------------------------------------------------

def main():
    problems = verify(SUITS)
    if problems:
        print("Данные не сходятся с конструктором, файлы не записаны:\n")
        for problem in problems:
            print(f"  {problem}")
        raise SystemExit(1)
    print(f"Сверка: все {len(SUITS)} готовых комплектов собираются конструктором.")

    files = make_components() + make_weapons() + make_journal() + make_actors()
    print(f"Записано исходников: {len(files)}")
    for path in files:
        print(f"  {os.path.relpath(path, ROOT)}")


main()

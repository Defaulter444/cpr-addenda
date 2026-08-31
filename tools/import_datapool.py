"""
Сборка предметов Data Pool в исходники модуля.

Скрипт берёт данные, извлечённые из выгрузок Data Pool (`docs/datapool.json`),
и раскладывает их в `sources/<пак>/*.json` — по файлу на предмет, готовому к
сборке в компендиум через `tools/build-packs.js`.

Принцип: тексты и числа берутся из документов как есть, потому что документ —
источник истины. Никакие игромеханические бонусы не додумываются: если правило
из документа не выражается средствами системы (замена режима огня, «+1d6 к
урону», подмена таблицы дальности), оно остаётся в описании предмета, а поля
данных не заполняются наугад.

    python tools/import_datapool.py
"""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MODULE_ROOT = Path(__file__).resolve().parent.parent
DATA = MODULE_ROOT / "docs" / "datapool.json"
SOURCES = MODULE_ROOT / "sources"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stat_effects  # noqa: E402  — лежит рядом, до правки sys.path не виден

#: Предметы, двигающие характеристики: подкладка Húsafell, внешний
#: экзоскелет. Эффекты у них общие с остальным модулем, из одной таблицы.
STAT_EFFECTS = stat_effects.load()

SOURCE_BOOK = "DataPool"

# --- Типы оружия системы ----------------------------------------------------

RANGED_ALL = [
    "assaultRifle", "bow", "grenadeLauncher", "heavyPistol", "heavySmg",
    "medPistol", "rocketLauncher", "shotgun", "smg", "sniperRifle",
    "vHeavyPistol",
]
RANGED_NO_BOW = [t for t in RANGED_ALL if t != "bow"]
PISTOLS = ["medPistol", "heavyPistol", "vHeavyPistol"]
SMGS = ["smg", "heavySmg"]
# «Тактическое оружие» — навык Shoulder Arms.
SHOULDER_ARMS = ["assaultRifle", "sniperRifle", "shotgun", "grenadeLauncher",
                 "rocketLauncher"]
BULLET_OR_SHOT = PISTOLS + SMGS + ["assaultRifle", "sniperRifle", "shotgun"]


def slug(text):
    """Имя файла из названия предмета."""
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    out = []
    for ch in text.lower():
        out.append(translit.get(ch, ch if ch.isalnum() else "-"))
    return re.sub(r"-+", "-", "".join(out)).strip("-")[:60]


def make_id(prefix, n):
    """
    Идентификатор документа: ровно 16 буквенно-цифровых символов.

    Стабильность важнее красоты — если id поменяется, все ссылки на предмет
    в мирах и на листах персонажей превратятся в битые.
    """
    base = f"cprAdd{prefix}{n:04d}"
    return (base + "0" * 16)[:16]


def html(text):
    """Абзацы из плоского текста."""
    chunks = [c.strip() for c in re.split(r"\n{2,}", text) if c.strip()]
    return "".join(f"<p>{c}</p>" for c in chunks) or "<p></p>"


def price_of(text):
    """Число из строки вида «100еЬ (Премиум)» или «2 552eb (О.Дорогое)»."""
    if not text:
        return 0
    match = re.search(r"([\d][\d\s.,]*)", text)
    if not match:
        return 0
    digits = re.sub(r"[^\d]", "", match.group(1))
    return int(digits) if digits else 0


def trim_tail(text):
    """
    Обрезает хвост, приклеившийся от соседней позиции.

    В вёрстке колонки перетекают одна в другую, и после «Источник: ...» иногда
    начинается описание следующего предмета вперемешку с шапкой таблицы.
    """
    cut = re.search(r"(Источник:\s*[^.]*?2045)", text)
    if cut:
        text = text[: cut.end()]
    text = re.sub(r"\s*Названние ОС ЧастьТела Штрафы Цена Описание Стиль\s*", " ", text)
    text = re.sub(r"\s*подходящее Модификация Описание Цена оружие\s*", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def format_tech(text):
    """
    Разбивает сплошной текст техапгрейда на абзацы.

    В документе это визуально разделённые блоки — поля стоимости, флейвор и
    абзац с механикой, — но при извлечении из PDF всё слипается в одну строку.
    Возвращаем разделение по опорным словам, иначе карточка предмета за столом
    читается как сплошная стена текста.
    """
    marks = [
        "Стоимость №1:", "Стоимость №2:", "Термометр:",
        "Изобретённый техапгрейд", "Источник:",
    ]
    separator = "\n\n"
    for mark in marks:
        text = text.replace(mark, separator + mark)
    return re.sub(r"\n{3,}", separator, text).strip()


def strip_next_title(text, titles):
    """
    Срезает с конца название следующего апгрейда или имя техника.

    Блоки в вёрстке идут встык, и заголовок следующего раздела попадает в
    хвост предыдущего: описание «Двойной Щепки» заканчивалось словами
    «Базовая Настройка».
    """
    changed = True
    while changed:
        changed = False
        stripped = text.rstrip(" .")
        for title in titles:
            if stripped.endswith(title):
                text = stripped[: -len(title)].rstrip(" .,—-")
                changed = True
                break

    # Последний апгрейд каждого техника прихватывает не только заголовок
    # следующего раздела, но и биографию следующего техника. Ищем имя во
    # второй половине текста и отрезаем всё от него — в начале и середине
    # имена не трогаем, там они могут быть частью самого правила.
    half = len(text) // 2
    cut = len(text)
    for title in titles:
        pos = text.find(title, half)
        if pos != -1:
            cut = min(cut, pos)
    return text[:cut].rstrip(" .,—-")


# --- Заготовки предметов ----------------------------------------------------

MODIFIER_KEYS = [
    "Wardrobe & Style", "attackmod", "bodySp", "cool", "damage", "headSp",
    "magazine", "rof", "sdp", "seats", "shieldHp", "slots", "speedCombat",
]


def with_modifiers(overrides=None):
    """Пустой набор модификаторов, поверх которого кладутся заданные."""
    mods = blank_modifiers()
    for key, data in (overrides or {}).items():
        mods[key] = {**mods.get(key, {}), **data}
    return mods


def blank_modifiers():
    mods = {
        key: {
            "isSituational": False,
            "onByDefault": False,
            "type": "modifier",
            "value": None,
        }
        for key in MODIFIER_KEYS
    }
    mods["secondaryWeapon"] = {"configured": False}
    return mods


def upgrade_item(doc_id, name, description, price, page, upgrade_type,
                 size=1, weapon_types=None, carrier_changes=None,
                 modifiers=None, aimed_penalty=None):
    """Модификация (itemUpgrade). Структура повторяет системные предметы."""
    own_flags = {}
    if weapon_types:
        own_flags["allowedWeaponTypes"] = weapon_types
        own_flags["deniedWeaponTypes"] = []
    if carrier_changes:
        own_flags["carrierChanges"] = carrier_changes
    if aimed_penalty is not None:
        own_flags["aimedShotPenalty"] = aimed_penalty
    flags = {"cpr-addenda": own_flags} if own_flags else {}
    return {
        "_id": doc_id,
        "name": name,
        "type": "itemUpgrade",
        "img": "modules/cpr-addenda/assets/icons/upgrade.svg",
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": flags,
        "system": {
            "ammoVariety": [],
            "attackmod": 0,
            "brand": "",
            "canIgnoreArmor": False,
            "concealable": {"concealable": False, "isConcealed": False},
            # Поле из схемы "attackable": модификация его не использует, но
            # система ожидает его наличия у любого предмета с этой схемой.
            "critFailEffect": "jammed",
            "damage": "1d6",
            "description": {"value": html(description)},
            "dvTable": "",
            "favorite": False,
            "fireModes": {"autoFire": 0, "suppressiveFire": False},
            "handsReq": 0,
            "ignoreArmorPercent": 0,
            "installLocation": "mall",
            "installedItems": {
                "allowed": False,
                "allowedTypes": ["itemUpgrade"],
                "list": [],
                "slots": 0,
                "usedSlots": 0,
            },
            "isElectronic": False,
            "isRanged": False,
            "magazine": {"ammoData": None, "max": 0, "value": 0},
            "modifiers": with_modifiers(modifiers),
            "price": {"market": price},
            "providesHardening": False,
            "revealed": True,
            "rof": 1,
            "size": size,
            "source": {"book": SOURCE_BOOK, "page": page},
            "type": upgrade_type,
            "unarmedAutomaticCalculation": True,
            "usage": "toggled",
            "usesType": "magazine",
            "weaponSkill": "",
            "weaponType": "",
        },
    }


def gear_item(doc_id, name, description, price, page):
    """Предмет снаряжения (gear).

    Часть снаряжения двигает характеристики — подкладка Húsafell поднимает ТЕЛ,
    внешний экзоскелет задаёт его целиком. Эффекты для них лежат в общей
    таблице: раньше их не было вовсе, и описание обещало то, чего на листе не
    происходило.
    """
    doc = {
        "_id": doc_id,
        "name": name,
        "type": "gear",
        "img": "modules/cpr-addenda/assets/icons/gear.svg",
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": {},
        "system": {
            "amount": 1,
            "brand": "",
            "concealable": {"concealable": False, "isConcealed": False},
            "description": {"value": html(description)},
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
            "source": {"book": SOURCE_BOOK, "page": page},
            "usage": "toggled",
        },
    }
    stat_effects.apply(doc, STAT_EFFECTS)
    return doc


def armor_item(doc_id, name, description, price, page, sp=0, penalty=0,
               location="body", shield_hp=0):
    """
    Броня. В системе комплект «тело + голова» — это два отдельных предмета,
    как сделано у всей штатной брони, поэтому вызывающий код разводит их сам.
    """
    is_shield = location == "shield"
    is_head = location == "head"
    is_body = location == "body"
    return {
        "_id": doc_id,
        "name": name,
        "type": "armor",
        "img": "modules/cpr-addenda/assets/icons/armor.svg",
        "folder": None,
        "sort": 0,
        "effects": [],
        "flags": {},
        "system": {
            "bodyLocation": {"ablation": 0, "sp": sp if is_body else 0},
            "brand": "",
            "concealable": {"concealable": False, "isConcealed": False},
            "description": {"value": html(description)},
            "equipped": "owned",
            "favorite": False,
            "headLocation": {"ablation": 0, "sp": sp if is_head else 0},
            "installedItems": {
                "allowed": True,
                "allowedTypes": ["itemUpgrade"],
                "list": [],
                "slots": 3,
                "usedSlots": 0,
            },
            "isBodyLocation": is_body,
            "isElectronic": False,
            "isHeadLocation": is_head,
            "isShield": is_shield,
            "penalty": penalty,
            "price": {"market": price},
            "providesHardening": False,
            "revealed": True,
            "shieldHitPoints": {"max": shield_hp, "value": shield_hp},
            "source": {"book": SOURCE_BOOK, "page": page},
            "usage": "equipped",
        },
    }


# --- Решения по каждой позиции ---------------------------------------------
# Здесь то, что нельзя вывести автоматически: в какое оружие ставится
# модификация, сколько слотов занимает, куда устанавливается техапгрейд.

# Боеприпасы, которыми стреляют пулей или дробью: их список расширяет
# «Модуль совместимости боеприпасов».
BULLET_AMMO = ["medPistol", "heavyPistol", "vHeavyPistol", "rifle",
               "shotgunShell", "shotgunSlug"]

WEAPON_MODS = {
    "Глушитель": dict(size=1, types=RANGED_NO_BOW),
    "Подствольный крюк-кошка": dict(size=1, types=SHOULDER_ARMS + ["bow"]),
    "Штык-Аэрогипо": dict(size=1, types=SHOULDER_ARMS),
    "Модуль совместимости боеприпасов": dict(
        size=0, types=BULLET_OR_SHOT,
        # «Оружие получает возможность стрелять всеми небазовыми боеприпасами
        # любой категории». Дописываем пулевые и дробовые категории к тем, что
        # у ствола уже есть, — операция add не затирает исходные.
        changes={"system.ammoVariety": {"op": "add", "value": BULLET_AMMO}},
    ),
    "Усиленная тетива": dict(size=0, types=["bow"]),
    "Перекалибровка снайперской винтовки": dict(size=0, types=["sniperRifle"]),
    # Экзотическое оружие не выделено отдельным типом в системе,
    # поэтому ограничение не задаём — оно остаётся в описании.
    "Рельса совместимости": dict(
        size=0, types=[],
        # Штатный модификатор слотов: система считает его для любого предмета
        # с поддержкой апгрейдов, не только для кибердек.
        mods={"slots": {"type": "modifier", "value": 1}},
    ),
    "Модификация таблицы дальности": dict(size=0, types=RANGED_ALL),
    "Автоспуск пистолета": dict(
        size=0, types=PISTOLS,
        # «Автоогонь (Автоматический пистолет 3) и подавляющий огонь».
        # Повышение до 4 на оружии отличного качества остаётся мастеру.
        changes={
            "system.fireModes.autoFire": {"op": "set", "value": 3},
            "system.fireModes.suppressiveFire": {"op": "set", "value": True},
        },
    ),
    "Узел автоматического управления огнём": dict(
        size=0, types=["shotgun"],
        changes={"system.fireModes.autoFire": {"op": "set", "value": 3}},
    ),
    "Внутренний циклический механизм ПП": dict(
        size=0, types=SMGS,
        # «Замени автоогонь 3 на автоогонь 4».
        changes={"system.fireModes.autoFire": {"op": "set", "value": 4}},
    ),
}

# Броня: ОС, штраф, из каких частей состоит комплект.
ARMOR_SPECS = {
    "Лёгкий Металгир": dict(sp=16, penalty=-3, parts=["body", "head"]),
    "Тяжёлый Metalgear®": dict(sp=19, penalty=-4, parts=["body", "head"],
                               note="−4 РЕА, −5 ЛВК, −5 СКО"),
    "Гибридный Metalgear®": dict(sp=17, penalty=-3, parts=["body", "head"],
                                 note="−3 РЕА, −4 ЛВК, −4 СКО"),
    "Кустарная броня, броня из хлама": dict(sp=11, penalty=0, parts=["body"]),
    "Высокплотный Пуленепробиваемый щит": dict(sp=0, penalty=0,
                                               parts=["shield"], shield_hp=15),
}

PART_SUFFIX = {"body": " (тело)", "head": " (голова)", "shield": ""}

MELEE_ALL = ["lightMelee", "medMelee", "heavyMelee", "vHeavyMelee"]
FIREARMS = PISTOLS + SMGS + ["assaultRifle", "sniperRifle", "shotgun"]

# Техапгрейды: куда устанавливается каждый. Где документ уточняет род оружия
# («оружие с лезвием», «огнестрельное оружие»), это переносится в список типов.
TECH_TARGETS = {
    "Двойная Щепка": ("cyberware", None),
    "Базовая Настройка": ("cyberware", None),
    "Беговая Ракета": ("cyberware", None),
    "Комбинированное Подствольное Приспособление": ("weapon", SHOULDER_ARMS),
    "Система Противовесов": ("weapon", None),
    "Оптимизированное Выкидное Оружие": ("cyberware", None),
    "Функциональный Драйвер": ("cyberdeck", None),
    "Инсуляция Сетевого Костюма": ("armor", None),
    "Шоковый Кролик": ("weapon", FIREARMS),
    "Ворпальное Покрытие": ("weapon", MELEE_ALL),
    "Маяк-вспышка": ("vehicle", None),
    "Покрытие Metalgear®": ("vehicle", None),
    "Автономный Транспорт": ("vehicle", None),
    "Калиброванный Медсканер": ("gear", None),
    "Рубящий Топор": ("weapon", MELEE_ALL),
    "Суперсканер": ("weapon", None),
}

# Эти два апгрейда ставятся на боеприпасы и на программу, а такие типы
# предметов система улучшать не умеет вовсе. Заводим их обычными предметами,
# чтобы позиция существовала и её можно было выдать игроку.
TECH_AS_GEAR = {"Экспериментальная Нагрузка", "Супер Подкат"}

# Модификаторы, которые техапгрейд добавляет носителю.
# Отрицательные значения проходят только типом «замена»: для «прибавки»
# система отбирает модификаторы фильтром «больше нуля» и минус теряет.
TECH_MODIFIERS = {}

# Модификации, которые заменяют штраф за прицельный выстрел.
# Суперсканер наводит атаку: по документу такая проверка идёт со штрафом −4,
# и это не добавка к штатным −8, а замена — иначе прицельный выстрел с ним
# выходил бы вдвое хуже обычного.
TECH_AIMED = {
    "Суперсканер": -4,
}

# Правки, которые техапгрейд вносит в предмет-носитель.
TECH_CHANGES = {
    # «Усиливает и добавляет остриё инструменту — теперь это и музыкальный
    # инструмент, и тяжёлое холодное оружие.» Ставится на оружие и поднимает
    # его до тяжёлого холодного с соответствующим уроном.
    "Рубящий Топор": {
        "system.weaponType": {"op": "set", "value": "heavyMelee"},
        "system.damage": {"op": "set", "value": "3d6"},
    },
}


# Модификации ствола из таблицы «Типы Модификации Таблицы Дальности».
# Каждая переводит оружие на другую таблицу дальности; варианты «по умолчанию»
# не заводим — это и есть исходное состояние ствола.
BARREL_MODS = [
    ("Пистолетный короткий ствол", PISTOLS, "Укороченный пистолет"),
    ("Пистолетный длинный ствол", PISTOLS, "Удлинённый пистолет"),
    ("Короткий ствол ПП", SMGS, "Субкомпактный ПП"),
    ("Короткий ствол дробовика", ["shotgun"], "Укороченный дробовик"),
    ("Длинный ствол дробовика", ["shotgun"], "Удлинённый дробовик"),
    ("Ствол карабина", ["assaultRifle"], "Карабин"),
    ("Ствол боевой винтовки", ["assaultRifle"], "Боевая винтовка"),
    ("Ствол марксманской винтовки", ["assaultRifle"], "Марксманская винтовка"),
    ("Ствол скаутской винтовки", ["sniperRifle"], "Скаутская винтовка"),
    ("Длинный ствол снайперской винтовки", ["sniperRifle"],
     "Крупнокалиберная снайперская винтовка"),
    ("Короткие плечи", ["bow"], "Короткий лук/арбалет"),
    ("Длинные плечи", ["bow"], "Длинный лук/арбалет"),
]

BARREL_DESCRIPTION = "\n\n".join([
    "Модификация таблицы дальности. Пока она установлена, таблица дальности"
    " оружия заменяется на «{table}». Урон, типы боеприпасов и прочие"
    " характеристики оружия не изменяются.",

    "Это приспособление не требует слота приспособлений и может"
    " устанавливаться на экзотическое оружие. Одновременно может быть"
    " установлена только одна модификация таблицы дальности.",

    "Источник: Соло Удачи 2045",
])


# Разделитель абзацев описания.
PARAGRAPH = "\n\n"

# Предметы из источников помимо четырёх выгрузок Data Pool. У каждого указана
# своя книга, чтобы за столом было видно, откуда позиция взята.
EXTRA_GEAR = [
    {
        "name": "Ароматизированные Сигареты",
        "brand": "Biotechnica",
        "icon": "modules/cpr-addenda/assets/icons/cigarettes.svg",
        "price": 2,
        "source": {"book": "Chromebook", "page": 0},
        "description": PARAGRAPH.join([
            "«Новинка от Biotechnica!»",

            "Образец новейшего творения Biotechnica с настоящим, генетически"
            " изменённым табаком. Специальная линия ароматизированных сигарет"
            " Biotechnica обещает длительное удовольствие от курения."
            " 2eb/упаковка, 15eb/коробка.",

            "Доступны следующие ароматы: Настоящий мужчина — Острый перец,"
            " Следопыт — Копчёный бекон, Сладкие Альпы — Шоколад,"
            " Зелёные друзья — Клубника, Итальяно — Пицца,"
            " Высшая улица — Гашиш.",
        ]),
    },
]


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    written = {}

    def write(pack, doc):
        folder = SOURCES / pack
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{slug(doc['name'])}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        written.setdefault(pack, []).append(doc["name"])

    counter = 0

    # 1. Модификации оружия.
    for entry in data["weapon_mods"]:
        spec = WEAPON_MODS[entry["name"]]
        counter += 1
        write("addenda-upgrades", upgrade_item(
            make_id("Wm", counter), entry["name"], trim_tail(entry["description"]),
            price_of(entry["price"]), entry["page"], "weapon",
            size=spec["size"], weapon_types=spec["types"],
            carrier_changes=spec.get("changes"), modifiers=spec.get("mods"),
        ))

    # 2. Броня.
    for entry in data["armor"]:
        spec = ARMOR_SPECS[entry["name"]]
        description = trim_tail(entry["description"])
        if spec.get("note"):
            description += (
                f" [Штрафы по документу: {spec['note']}. Система применяет"
                f" единый штраф {spec['penalty']} к РЕА, ЛВК и СКО.]"
            )
        for part in spec["parts"]:
            counter += 1
            write("addenda-armor", armor_item(
                make_id("Ar", counter),
                entry["name"] + PART_SUFFIX[part],
                description, price_of(entry["price"]), entry["page"],
                sp=spec["sp"], penalty=spec["penalty"], location=part,
                shield_hp=spec.get("shield_hp", 0),
            ))

    # 3. Снаряжение.
    for entry in data["gear"]:
        counter += 1
        write("addenda-gear", gear_item(
            make_id("Ge", counter), entry["name"], trim_tail(entry["description"]),
            price_of(entry["price"]), entry["page"],
        ))

    # 4. Техапгрейды.
    # Заголовки, которые могли затечь в хвост соседнего блока: названия самих
    # апгрейдов и имена техников, чьи разделы их разделяют.
    tech_titles = [e["name"] for e in data["tech"]] + [
        "Андроид Эйс", "Джек Сойер", "Лотос", "Послушный Недд",
        "Трой Гордон", "Твик",
    ]
    for entry in data["tech"]:
        name = entry["name"]
        # Поля «СЛ Модификации», «Стоимость» и «Термометр» уже стоят в начале
        # текста блока — там же, где они в документе. Повторять их не нужно,
        # достаточно расставить абзацы и срезать затёкший чужой заголовок.
        description = strip_next_title(
            format_tech(trim_tail(entry["description"])), tech_titles
        )
        price = price_of(entry["cost2"])
        counter += 1
        if name in TECH_AS_GEAR:
            write("addenda-gear", gear_item(
                make_id("Te", counter), name, description, price, 0))
        else:
            target, types = TECH_TARGETS[name]
            write("addenda-upgrades", upgrade_item(
                make_id("Te", counter), name, description, price, 0,
                target, size=1, weapon_types=types,
                carrier_changes=TECH_CHANGES.get(name),
                modifiers=TECH_MODIFIERS.get(name),
                aimed_penalty=TECH_AIMED.get(name),
            ))

    # 5. Модификации ствола: меняют таблицу дальности носителя.
    for name, types, table in BARREL_MODS:
        counter += 1
        write("addenda-upgrades", upgrade_item(
            make_id("Br", counter), name,
            BARREL_DESCRIPTION.format(table=table),
            100, 9, "weapon", size=0, weapon_types=types,
            carrier_changes={
                "system.dvTable": {"op": "set", "value": table}
            },
        ))

    # 6. Позиции из других источников.
    for extra in EXTRA_GEAR:
        counter += 1
        item = gear_item(
            make_id("Ex", counter), extra["name"], extra["description"],
            extra["price"], 0,
        )
        item["system"]["source"] = extra["source"]
        item["system"]["brand"] = extra.get("brand", "")
        if extra.get("icon"):
            item["img"] = extra["icon"]
        write("addenda-gear", item)

    total = 0
    for pack, names in sorted(written.items()):
        print(f"{pack:18} {len(names):3} предметов")
        total += len(names)
    print(f"\nВсего записано: {total}")


main()

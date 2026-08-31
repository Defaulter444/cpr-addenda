# -*- coding: utf-8 -*-
"""
Активные эффекты предметов, меняющих характеристики.

Часть предметов документа двигает статы: гидравлика корпуса ПКТ поднимает РЕА,
ЛВК и СКО, эндоскелет задаёт ТЕЛ, подкладка Húsafell прибавляет два. В файлах
предметов этого не было вовсе — описание обещало, а на листе не менялось
ничего.

Задавать эффекты прямо в сборщиках нельзя: файлы одних и тех же предметов пишут
разные скрипты, и дописанное одним стиралось другим при следующем запуске —
ровно так пропал эффект у «Эндоскелета Омега». Поэтому таблица одна, лежит в
docs/stat-effects.json, а сборщики зовут отсюда `apply`.

Форма эффекта повторяет системную дословно, и это не аккуратизм. Cyberpunk RED
читает у каждого изменения свои флаги — `flags.cyberpunk-red-core.changes.cats`
и `.situational` — **без всякой проверки**:

    this.category = effect.flags[game.system.id].changes.cats?.[index];

Эффект с пустыми флагами роняет отрисовку листа целиком: «Cannot read properties
of undefined (reading 'changes')». Лист после этого не открывается вообще —
именно так у мастера перестала открываться «шестёрка», на которую поставили
Драгуна.

Проверку замыкает validate-items.js: он читает ту же таблицу и требует, чтобы
эффект доехал до собранного предмета и был правильной формы.
"""

import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLE = os.path.join(ROOT, "docs", "stat-effects.json")

#: Идентификаторы эффектов должны быть постоянными: иначе каждая пересборка
#: давала бы предмету «новый» эффект, а у уже разложенных по листам остался бы
#: старый. Собираем из имени предмета, чтобы не вести отдельный счётчик.
ID_PREFIX = "cprAddFx"

#: Поля длительности, которые система заполняет у своих эффектов. Пустые, но
#: присутствовать должны: их читают и лист эффекта, и сравнение при обновлении.
DURATION = {
    "combat": None,
    "rounds": None,
    "seconds": None,
    "startRound": None,
    "startTime": None,
    "startTurn": None,
    "turns": None,
}


def load():
    """Читает таблицу эффектов.

    @returns {dict} - {имя предмета: {usage, why, cat, changes}}
    """
    return json.load(io.open(TABLE, encoding="utf-8"))["items"]


def effect_id(name):
    """Постоянный идентификатор эффекта по имени предмета.

    Шестнадцать символов, как требует Foundry и наш валидатор: восемь на
    префикс и восемь на хэш имени.

    @param {str} name - название предмета
    @returns {str}
    """
    digest = 0
    for char in name:
        digest = (digest * 131 + ord(char)) % (36 ** 8)
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    tail = ""
    for _ in range(8):
        digest, rest = divmod(digest, 36)
        tail = alphabet[rest] + tail
    return ID_PREFIX + tail


def category_of(key):
    """Категория изменения — та, что система показывает на листе эффекта.

    Категорий у неё семь; нам хватает двух. Ключи характеристик — «stat»,
    прибавки к навыкам — «skill». Ошибиться здесь не страшно для расчёта, но
    категория попадает в интерфейс, и чужая сбивала бы с толку.

    @param {str} key - ключ изменения
    @returns {str}
    """
    return "stat" if key.startswith("system.stats.") else "skill"


def build(name, changes, img=None, description=""):
    """Собирает активный эффект в том виде, в каком его делает система.

    @param {str} name - имя эффекта, обычно совпадает с именем предмета
    @param {list} changes - изменения [{key, mode, value}]
    @param {str} img - иконка
    @param {str} description - пояснение, откуда правило
    @returns {dict}
    """
    return {
        "_id": effect_id(name),
        "name": name,
        "img": img,
        "type": "base",
        "changes": [
            {
                "key": change["key"],
                "mode": change["mode"],
                "value": change["value"],
                "priority": None,
            }
            for change in changes
        ],
        "disabled": False,
        "duration": dict(DURATION),
        "description": description,
        "origin": None,
        "tint": "#ffffff",
        "transfer": True,
        "statuses": [],
        "sort": 0,
        "system": {},
        # Без этих флагов система падает при отрисовке листа: она читает
        # `flags.cyberpunk-red-core.changes.cats` без проверки на существование.
        "flags": {
            "cyberpunk-red-core": {
                "changes": {
                    "cats": {
                        str(index): category_of(change["key"])
                        for index, change in enumerate(changes)
                    },
                    "situational": {
                        str(index): {"isSituational": False, "onByDefault": False}
                        for index, _ in enumerate(changes)
                    },
                }
            }
        },
    }


def apply(doc, table=None):
    """Навешивает на предмет его эффект, если он есть в таблице.

    Заодно правит `usage`: система гасит эффекты предмета, пока он не надет или
    не установлен, и решает это именно по `usage`. Со значением по умолчанию
    («toggled») прибавка к ТЕЛ действовала бы и от подкладки, лежащей в рюкзаке.

    @param {dict} doc - документ предмета
    @param {dict} table - таблица, если уже прочитана
    @returns {bool} - применили ли эффект
    """
    entry = (table if table is not None else load()).get(doc.get("name"))
    if not entry:
        return False

    doc["effects"] = [
        build(
            doc["name"],
            entry["changes"],
            img=doc.get("img"),
            description=entry.get("why", ""),
        )
    ]
    if entry.get("usage"):
        doc.setdefault("system", {})["usage"] = entry["usage"]
    return True

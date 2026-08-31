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

Проверку замыкает validate-items.js: он читает ту же таблицу и требует, чтобы
эффект доехал до собранного предмета. Забытый вызов `apply` роняет сборку, а не
уходит в релиз молча.
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


def load():
    """Читает таблицу эффектов.

    @returns {dict} - {имя предмета: {usage, why, changes}}
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
        {
            "_id": effect_id(doc["name"]),
            "name": doc["name"],
            "img": doc.get("img"),
            "changes": [
                {
                    "key": change["key"],
                    "mode": change["mode"],
                    "value": change["value"],
                    "priority": None,
                }
                for change in entry["changes"]
            ],
            "disabled": False,
            "duration": {"startTime": None},
            "description": entry.get("why", ""),
            "origin": None,
            "tint": "#ffffff",
            "transfer": True,
            "statuses": [],
            "flags": {},
        }
    ]
    if entry.get("usage"):
        doc.setdefault("system", {})["usage"] = entry["usage"]
    return True

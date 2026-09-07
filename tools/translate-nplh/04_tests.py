# -*- coding: utf-8 -*-
"""Приводит проверки No Place Like Home к переведённым сообщениям.

Тесты сверяли текст ошибок по-английски. Поведение они проверяют то же самое —
меняется только образец, с которым сравнивают.
"""
import glob
import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"C:\Users\Horusian\AppData\Local\FoundryVTT\Data\modules\no-place-like-home"

PAIRS = [
    ("/Eurobucks/", "/негодный счёт/"),
    ("/ledger/", "/негодный счёт/"),
    ("/GM/", "/мастер/"),
    ("/Morale/", "/Подъёма духа/"),
    ("/Role/", "/ролей этого персонажа/"),
    ("/Select/", "/Выберите хотя бы одного/"),
    ("/Spend 15 HQ IP/", "/Потратить 15 ОУ штаба/"),
    ("/access is lost/", "/Доступ к штабу потерян/"),
    ("/already/", "/уже/"),
    ("/cost changed/", "/Цена покупки изменилась/"),
    ("/changed/", "/изменил/"),
    ("/own/", "/которым владеете/"),
    ("/refund/", "/возвращены/"),
    ("/vehicle/", "/транспорт/"),
    ("/permission/", "/прав открыть/"),
    ("'Restricted sheet'", "'Лист закрыт'"),
    ('"Restricted sheet"', '"Лист закрыт"'),
    ("'Missing sheet'", "'Лист пропал'"),
    ("'Empty slot'", "'Пусто'"),
    ("-15 HQ IP", "−15 ОУ штаба"),
    ("/Money award/", "/Начисление \\\\(деньги\\\\)/"),
]

changed = 0
for path in sorted(glob.glob(os.path.join(ROOT, "tests", "*.test.mjs"))):
    text = io.open(path, encoding="utf-8").read()
    before = text
    for old, new in PAIRS:
        text = text.replace(old, new)
    if text != before:
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)
        changed += 1
        print("  обновлён", os.path.basename(path))
print("файлов проверок изменено:", changed)

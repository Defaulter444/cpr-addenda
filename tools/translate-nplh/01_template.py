# -*- coding: utf-8 -*-
"""Перевод листа штаб-квартиры No Place Like Home.

Трогаем ТОЛЬКО видимый текст и подписи для чтения с экрана (alt, title,
aria-label, placeholder). Ни одно выражение `{{...}}`, ни одно `name=`,
`data-*` или имя класса не меняется — на них держится вся работа листа.

После замены скрипт сам проверяет, что число выражений Handlebars, число
полей ввода и число кнопок не изменилось.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"C:\Users\Horusian\AppData\Local\FoundryVTT\Data\modules\no-place-like-home"
PATH = os.path.join(ROOT, "templates", "hq.hbs")

# Порядок важен: длинные строки идут раньше своих кусков.
PAIRS = [
    # Шапка
    ("CREW DOSSIER / HEADQUARTERS", "ДОСЬЕ КОМАНДЫ / ШТАБ-КВАРТИРА"),
    ('aria-label="Headquarters name"', 'aria-label="Название штаб-квартиры"'),
    ('alt="Headquarters image"', 'alt="Изображение штаб-квартиры"'),
    ("<span>HQ image</span>", "<span>Изображение</span>"),
    ('title="Choose HQ image">Choose image<', 'title="Выбрать изображение штаб-квартиры">Выбрать изображение<'),
    ('title="Remove image"', 'title="Убрать изображение"'),
    ('aria-label="Headquarters sections"', 'aria-label="Разделы штаб-квартиры"'),

    # Вкладки
    (">HQ Info<", ">О штаб-квартире<"),
    (">Crew</a>", ">Команда</a>"),
    (">Active Crew Benefits<", ">Действующие блага<"),
    (">Improvements &amp; Upgrades<", ">Улучшения<"),
    (">Improvements & Upgrades<", ">Улучшения<"),
    (">Recent Activity<", ">Последние события<"),

    # Предупреждения
    ("Shared crew record · Your GM manages purchases and edits.",
     "Общая запись команды · покупки и правки ведёт мастер."),
    ("ACCESS LOST — HQ benefits are suspended.",
     "ДОСТУП ПОТЕРЯН — блага штаб-квартиры не действуют."),
    ("Restore the upgraded Workstation before other purchases.",
     "Сперва восстановите улучшенную мастерскую, потом остальные покупки."),
    (">Resolve Team Member departure<", ">Разобраться с уходом соратника<"),

    # Вкладка «О штаб-квартире»
    ("<label>Location<", "<label>Расположение<"),
    ("<label>Crew name / notes<", "<label>Название команды или заметка<"),
    ("<label>Description<", "<label>Описание<"),
    ("<label>Original monthly rent (eb)<", "<label>Исходная аренда в месяц (eb)<"),
    ("<label>Reduced rent (GM total, eb)<", "<label>Сниженная аренда (итог от мастера, eb)<"),
    ("<label>Original beds<", "<label>Исходных спальных мест<"),
    ("> Crew has access<", "> У команды есть доступ<"),
    ("> NPC faction HQ (blocks crew IP spending)<",
     "> Штаб фракции НИП (запрещает тратить ОУ команды)<"),
    ("<span>Available HQ IP</span>", "<span>Доступно ОУ штаба</span>"),
    ("<span>Lifetime HQ IP spent</span>", "<span>Всего потрачено ОУ штаба</span>"),
    ("<span>Monthly rent</span>", "<span>Аренда в месяц</span>"),
    ("<span>Total beds</span>", "<span>Всего спальных мест</span>"),
    ('aria-label="HQ IP award"', 'aria-label="Начисление ОУ штаба"'),
    (">Award HQ IP<", ">Начислить ОУ штаба<"),
    ("Award once per crew, equal to Group IP—not multiplied by members.",
     "Начисляется один раз на команду и равно групповым ОУ — не умножается на число бойцов."),

    # Вкладка «Команда»
    ("<h2>Crew <small>Six spaces · click a portrait to open its sheet</small></h2>",
     "<h2>Команда <small>Шесть мест · щелчок по портрету открывает лист</small></h2>"),
    ('alt="{{name}} portrait"', 'alt="Портрет: {{name}}"'),
    ('title="Unlink crew sheet"', 'title="Отвязать лист"'),
    (" Award crew IP<", " Начислить ОУ команде<"),
    (" Award crew money<", " Начислить деньги команде<"),
    ("The GM can drag and drop character sheets from the Actors directory into the six crew slots. Click a portrait to open its sheet.",
     "Мастер перетаскивает листы персонажей из вкладки актёров в шесть мест команды. Щелчок по портрету открывает лист."),
    ("<h3>Garage</h3>", "<h3>Гараж</h3>"),
    ('alt="Vehicle"', 'alt="Транспорт"'),
    ("Drop a vehicle Item or vehicle Actor sheet here.",
     "Перетащите сюда транспорт — предметом или листом актёра."),
    (">Unlink vehicle<", ">Отвязать транспорт<"),
    ("<h3>Shared stash</h3>", "<h3>Общий склад</h3>"),
    (" item entries</p>", " записей о предметах</p>"),
    (">Open item storage<", ">Открыть склад<"),
    (">Deposit eb<", ">Положить eb<"),
    (">Withdraw eb<", ">Снять eb<"),
    ("Store items by dragging them into the stash sheet. Retrieve using its item transfer controls and selected character.",
     "Складывайте предметы, перетаскивая их в лист склада. Забирают оттуда же — через передачу предмета выбранному персонажу."),
    ("The linked stash is missing.", "Привязанный склад пропал."),
    ("The GM can create shared storage here.", "Мастер может завести здесь общий склад."),
    (">Sync player access<", ">Обновить доступ игроков<"),
    (">Create shared stash<", ">Создать общий склад<"),

    # Вкладка «Блага»
    ("<h2>Active crew benefits</h2>", "<h2>Действующие блага команды</h2>"),
    ("Choose a character you own when using an action. Healing, Humanity and Hustle update that character automatically. Apply other conditional bonuses manually.",
     "Выбирайте персонажа, которым владеете. Лечение, человечность и подработка меняют его сами. Остальные условные бонусы применяйте вручную."),
    ("<p>Natural healing: <b>BODY +", "<p>Естественное лечение: <b>ТЕЛО +"),
    (" Heal…</button>", " Лечить…</button>"),
    ("<p>LUCK increase: <b>+", "<p>Прибавка к УДЧ: <b>+"),
    ("<p>Lifestyle saving: <b>", "<p>Экономия на быте: <b>"),
    ("eb / member / month</b></p>", "eb с бойца в месяц</b></p>"),
    ("<p>Monthly Humanity: <b>", "<p>Человечность за месяц: <b>"),
    (" Roll &amp; restore…</button>", " Бросить и восстановить…</button>"),
    (" Roll & restore…</button>", " Бросить и восстановить…</button>"),
    ("<p>Hustle: <b>", "<p>Подработка: <b>"),
    (" Roll &amp; earn…</button>", " Бросить и заработать…</button>"),
    (" Roll & earn…</button>", " Бросить и заработать…</button>"),
    ("Job pay: Fixers gain +2 Trading; non-Fixers can negotiate a 20% increase as Operator 5, without a Trading bonus.",
     "Оплата работы: фиксеры получают +2 к торговле; остальные могут выторговать +20% как «Оператор 5», но без прибавки к торговле."),
    ("Morale upgrade 10: record the crew's GM-approved unique benefit in Notes.",
     "Десятое улучшение боевого духа: запишите в заметки особое благо команды, одобренное мастером."),
    ("<h3>Custom benefits <small>Apply effects manually</small></h3>",
     "<h3>Свои блага <small>Применяются вручную</small></h3>"),
    ("<label>Notes / training expiry / projects / selected Team Member<",
     "<label>Заметки: сроки обучения, проекты, выбранный соратник<"),

    # Вкладка «Улучшения»
    ("<h2>Improvements &amp; upgrades <small>", "<h2>Улучшения <small>"),
    ("<h2>Improvements & upgrades <small>", "<h2>Улучшения <small>"),
    (" HQ IP per purchase</small></h2>", " ОУ штаба за покупку</small></h2>"),
    ("Cost for every improvement or upgrade (HQ IP)",
     "Цена любого улучшения или его ступени (ОУ штаба)"),
    ("Default: 40. Applies to future purchases for this HQ; previous spending stays recorded at its original cost.",
     "По умолчанию 40. Действует на будущие покупки этого штаба; уже потраченное остаётся записанным по прежней цене."),
    (">Add custom improvement<", ">Добавить своё улучшение<"),
    ("Create a name, base benefit and ordered upgrade benefits. Custom purchases use the same HQ IP cost; apply their effects manually.",
     "Задайте название, основное благо и ступени по порядку. Цена та же, что у прочих; действие применяется вручную."),
    (">Owned<", ">Куплено<"),
    (">Not acquired<", ">Не куплено<"),
    ('<p class="rank">Upgrades ', '<p class="rank">Ступеней '),
    ("{{#if custom}}Custom{{else}}DLC p. {{page}}{{/if}}",
     "{{#if custom}}Своё{{else}}DLC, с. {{page}}{{/if}}"),
    ("<summary>Upgrade benefits (purchase order)</summary>",
     "<summary>Блага ступеней (по порядку покупки)</summary>"),
    ("<li>No upgrades defined.</li>", "<li>Ступени не заданы.</li>"),
    ("<summary>Upgrade benefit</summary>", "<summary>Благо ступени</summary>"),
    ("{{#if owned}}Upgrade{{else}}Acquire{{/if}} · {{../s.purchaseCost}} IP",
     "{{#if owned}}Улучшить{{else}}Купить{{/if}} · {{../s.purchaseCost}} ОУ"),
    (">Lost</button>", ">Потеряно</button>"),
    (">Edit custom<", ">Править<"),
    (">Delete custom<", ">Удалить<"),

    # Вкладка «События»
    ("<h2>Recent activity</h2>", "<h2>Последние события</h2>"),
    ("<li>No purchases or awards yet.</li>", "<li>Пока ни покупок, ни начислений.</li>"),
    (">Record HQ destruction<", ">Записать разрушение штаба<"),
    ("Unofficial companion to R. Talsorian Games' No Place Like Home (2024). Refer to your DLC and core rulebook for complete rules.",
     "Неофициальное дополнение к «No Place Like Home» (2024) от R. Talsorian Games. Полные правила — в самом DLC и основной книге."),
]

text = io.open(PATH, encoding="utf-8").read()
before = text

def count(pattern, where):
    return len(re.findall(pattern, where))

marks = {
    "выражений Handlebars": count(r"\{\{", text),
    "закрытий Handlebars": count(r"\}\}", text),
    "полей name=": count(r'name="[^"]*"', text),
    "атрибутов data-": count(r"\bdata-[a-z-]+=", text),
    "кнопок": count(r"<button", text),
    "классов": count(r'class="[^"]*"', text),
}

used = 0
for old, new in PAIRS:
    if old in text:
        text = text.replace(old, new)
        used += 1

after = {
    "выражений Handlebars": count(r"\{\{", text),
    "закрытий Handlebars": count(r"\}\}", text),
    "полей name=": count(r'name="[^"]*"', text),
    "атрибутов data-": count(r"\bdata-[a-z-]+=", text),
    "кнопок": count(r"<button", text),
    "классов": count(r'class="[^"]*"', text),
}

for key, value in marks.items():
    if after[key] != value:
        sys.exit(f"{key}: было {value}, стало {after[key]} — перевод задел разметку")

# Английского в видимом тексте остаться не должно (кроме имён собственных).
leftovers = [
    s for s in re.findall(r">([^<>{}]{4,})<", text)
    if re.search(r"[A-Za-z]{3}", s)
    and not re.search(r"[А-Яа-яЁё]", s)
    and s.strip() not in {"No Place Like Home"}
]

io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
print(f"применено замен: {used} из {len(PAIRS)}")
print("разметка не тронута:", ", ".join(f"{k} {v}" for k, v in after.items()))
if leftovers:
    print("осталось по-английски:", leftovers)
else:
    print("английского в видимом тексте не осталось")

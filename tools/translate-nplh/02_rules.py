# -*- coding: utf-8 -*-
"""Перевод правил и названий улучшений No Place Like Home.

Меняем ТОЛЬКО тексты в кавычках, которые видит игрок. Идентификаторы улучшений
(`evidence`, `garage`, `lockup`…) не трогаем: на них держится вся запись покупок,
и переименование стёрло бы уже купленное.

Названия навыков взяты из русского перевода системы, чтобы текст правил
совпадал с тем, что написано на листах.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"C:\Users\Horusian\AppData\Local\FoundryVTT\Data\modules\no-place-like-home"
PATH = os.path.join(ROOT, "scripts", "rules.mjs")

PAIRS = [
    # --- названия улучшений -------------------------------------------------
    ('"Evidence Wall"', '"Стена улик"'),
    ('"Garage"', '"Гараж"'),
    ('"Lockup"', '"Камера"'),
    ('"Lounge"', '"Переговорная"'),
    ('"Medbay"', '"Медблок"'),
    ('"Morale Boost"', '"Подъём духа"'),
    ('"Rent Reduction"', '"Снижение аренды"'),
    ('"Server Room"', '"Серверная"'),
    ('"Studio"', '"Студия"'),
    ('"Training Area"', '"Тренировочная"'),
    ('"Workshop"', '"Мастерская"'),
    ('"Workstation"', '"Рабочее место"'),

    # --- благо и ступень каждого улучшения ----------------------------------
    ("Lawmen and Medias: +2 to investigation-related Composition, Criminology, Cryptography, Deduction, Education, Forgery, Library Search and Photograph/Film.",
     "Законники и медиа получают +2 к Композиции, Криминологии, Криптографии, Дедукции, Образованию, Фальсификации, Поиску информации и Фотографии/видео, когда это связано с расследованием."),
    ("Lawmen: bonus becomes +3. Medias retain +2 and gain +1 effective Credibility Rank for Believability on a story developed here.",
     "Законникам бонус растёт до +3. Медиа сохраняют +2 и получают +1 к рангу доверия при проверке правдоподобия материала, подготовленного здесь."),

    ("Crew Compact Groundcar; cannot be sold or benefit from Moto. Vehicle upgrades can be purchased separately. If destroyed beyond repair, lose this improvement and its upgrade without refund.",
     "У команды появляется компактный автомобиль. Продать его нельзя, и способность «Мото» на него не действует. Улучшения транспорта покупаются отдельно. Если машину разобьют без возможности починки, улучшение и его ступень пропадают без возврата."),
    ("A Nomad with all vehicles fully repaired and operational can spend one week reassigning Moto vehicle and upgrade choices.",
     "Кочевник, у которого весь транспорт цел и на ходу, может потратить неделю и заново распределить выбор машин и улучшений по «Мото»."),

    ("One soundproof cell. A prisoner needs BODY 13+ to break out; outside rescue remains possible.",
     "Одна звукоизолированная камера. Чтобы выломаться, пленнику нужно ТЕЛО 13 и выше; вытащить его снаружи по-прежнему можно."),
    ("Three separate cells. Lawmen gain +2 Interrogation against a prisoner held for at least one day.",
     "Три отдельные камеры. Законники получают +2 к Допросу пленника, просидевшего хотя бы сутки."),

    ("Fixers gain +2 Bribery, Bureaucracy, Business, Conversation, Human Perception, Persuasion and Trading during meetings held here.",
     "Фиксеры получают +2 к Взяточничеству, Бюрократии, Бизнесу, Общению, Проницательности, Убеждению и Торговле на встречах, которые проходят здесь."),
    ("Fixers and Medias gain +2 to checks arranging an in-person meeting within their Contacts/Clients or Access/Sources, as the GM decides.",
     "Фиксеры и медиа получают +2 к проверкам, когда договариваются о личной встрече среди своих связей и клиентов или источников и доступов — по решению мастера."),

    ("Crew natural healing uses BODY +2. Medtechs gain +2 First Aid, Paramedic and Surgery here.",
     "Естественное лечение команды считается как ТЕЛО +2. Медтехи получают здесь +2 к Первой помощи, Парамедицине и Хирургии."),
    ("Medtechs can use Science (Chemistry) for Maker-style street-drug upgrading, fabrication and invention; expertise equals Medical Tech skill level.",
     "Медтехи могут применять Науку (химию) для улучшения, изготовления и изобретения уличных наркотиков по правилам «Мастера»; уровень мастерства равен уровню навыка медтехники."),

    ("Recreation or decoration reduces each crew member's monthly Lifestyle cost by 50eb.",
     "Место для отдыха или обстановка снижают месячные бытовые расходы каждого бойца на 50 eb."),
    ("Up to ten upgrades; cumulative benefits with replacements shown below.",
     "До десяти ступеней; блага складываются, замены показаны ниже."),

    ("Reduce rent by one Real Estate category, skipping corporate-provided rows. Cube Hotel becomes 100eb/month. Requires monthly rent. Enter the GM-calculated reduced rent below.",
     "Аренда падает на одну ступень в таблице недвижимости, корпоративные строки пропускаются. Кубический отель становится 100 eb в месяц. Нужна месячная аренда. Итог, посчитанный мастером, впишите ниже."),
    ("Each upgrade adds one bed without raising rent, up to twice the original bed count. Extra rooms need GM agreement.",
     "Каждая ступень добавляет спальное место, не поднимая аренду, но не больше удвоенного исходного числа мест. Лишние комнаты — по согласию мастера."),

    ("Build an HQ NET Architecture/security system with a 20,000eb allocation using Home Security 2045. Purchased assets cannot be removed or resold; leftover funds are forfeited.",
     "Постройте сетевую архитектуру и охранную систему штаба на выделенные 20 000 eb по правилам «Home Security 2045». Купленное нельзя снять или перепродать, остаток денег сгорает."),
    ("Netrunners use Electronics/Security Tech for Maker-style cyberdeck, hardware and program projects; expertise equals Interface Rank.",
     "Нетраннеры применяют Электронику/безопасность для работ над кибердеками, железом и программами по правилам «Мастера»; уровень мастерства равен рангу интерфейса."),

    ("Rockerboys gain +2 Acting, Composition, Play Instrument, Paint/Draw/Sculpt and Photograph/Film while here.",
     "Рокербои получают здесь +2 к Актёрскому мастерству, Композиции, Игре на инструменте, Живописи/рисованию/скульптуре и Фотографии/видео."),
    ("A Rockerboy can refine an art project for one week per cumulative +2 on required art checks. Failure allows another week; completion, abandonment or a natural 1 ends the refinement bonus. Fumble Recovery cannot prevent its loss.",
     "Рокербой может доводить творческую работу: каждая неделя даёт накопительные +2 к нужным проверкам искусства. Неудача позволяет взять ещё неделю; завершение, отказ или чистая единица обнуляют накопленное. «Спасение от провала» этого не отменяет."),

    ("One week practices one skill for +1: Athletics, Archery, Autofire, Brawling, Evasion, Handgun, Heavy Weapons, Martial Arts, Melee Weapon or Shoulder Arms. Expires on the next Group IP award or new practice.",
     "Неделя занятий даёт +1 к одному навыку: Атлетика, Луки и арбалеты, Автоогонь, Драка, Уклонение, Короткоствольное оружие, Тяжёлое оружие, Боевые искусства, Холодное оружие или Длинноствольное оружие. Прибавка пропадает при следующем начислении групповых ОУ или при новых занятиях."),
    ("Solos may practice two different eligible skills at once.",
     "Соло могут заниматься сразу двумя разными подходящими навыками."),

    ("A Tech using Upgrade, Fabrication or Invention Expertise here can credit the same time toward a second project.",
     "Техник, работающий здесь по мастерству улучшения, изготовления или изобретения, засчитывает то же время и второму проекту."),
    ("The same time can also be credited toward a third project.",
     "То же время засчитывается и третьему проекту."),

    ("Choose one Exec Team Member. They become a crew member, gain IP when their Exec does, receive a share of gig pay, and follow their Exec to a new employer. GM spends their IP/cash. Losing access stops new awards, not past gains.",
     "Выберите одного соратника менеджера. Он становится бойцом команды, получает ОУ вместе со своим менеджером, долю с оплаты работы и уходит за ним к новому нанимателю. Его ОУ и деньги тратит мастер. Потеря доступа прекращает новые начисления, но не отнимает прежние."),
    ("The selected Team Member stays loyal unless betrayed. If this upgraded workstation is lost, restore it before other HQ purchases or the Team Member leaves.",
     "Выбранный соратник остаётся верен, пока его не предадут. Если улучшенное рабочее место потеряно, восстановите его прежде других покупок штаба — иначе соратник уйдёт."),

    # --- броски и режимы ----------------------------------------------------
    ('"2d6, keep highest"', '"2d6, берётся большее"'),
    ('"1d6 / 2 (round down)"', '"1d6 / 2, округление вниз"'),
    ('"Roll twice; earn both"', '"Бросить дважды, засчитать оба"'),
    ('"Roll twice; choose one"', '"Бросить дважды, выбрать один"'),

    # --- отказы -------------------------------------------------------------
    ("Invalid custom improvement ID.", "Неверный идентификатор своего улучшения."),
    ("Enter a name (up to 100 characters) and benefit (up to 4000 characters).",
     "Введите название (до 100 знаков) и описание блага (до 4000 знаков)."),
    ("Use at most 50 upgrades, each up to 4000 characters.",
     "Ступеней не больше пятидесяти, каждая до 4000 знаков."),
    ("Cannot remove already purchased upgrade tiers. Record the improvement as lost first.",
     "Нельзя убрать уже купленные ступени. Сперва отметьте улучшение как потерянное."),
    ("Purchase cost must be a non-negative whole number of HQ IP.",
     "Цена покупки — целое неотрицательное число ОУ штаба."),
    ("Crew HQ IP cannot be spent on a faction HQ.",
     "ОУ команды нельзя тратить на штаб фракции."),
    ("Restore access before making purchases.",
     "Верните доступ, прежде чем что-то покупать."),
    ("Restore the upgraded Workstation first, or resolve the Team Member's departure.",
     "Сперва восстановите улучшенное рабочее место или разберитесь с уходом соратника."),
    ("Maximum upgrades reached.", "Больше ступеней у этого улучшения нет."),
    ("Rent Reduction requires a monthly rent cost.",
     "Снижение аренды требует, чтобы аренда вообще была."),
    ('"Unknown improvement."', '"Неизвестное улучшение."'),
    ("Not enough HQ IP (${cost} required).",
     "Не хватает ОУ штаба (нужно ${cost})."),
]

text = io.open(PATH, encoding="utf-8").read()
ids = re.findall(r'\["([a-z]+)",', text)
interpolations = text.count("${")

applied = 0
for old, new in PAIRS:
    if old in text:
        text = text.replace(old, new)
        applied += 1
    else:
        print("  НЕ НАЙДЕНО:", old[:70])

after_ids = re.findall(r'\["([a-z]+)",', text)
if ids != after_ids:
    sys.exit("идентификаторы улучшений изменились — это стёрло бы купленное")
if text.count("${") != interpolations:
    sys.exit("число подстановок изменилось")

io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
print(f"переведено строк: {applied} из {len(PAIRS)}")
print("идентификаторы улучшений целы:", ", ".join(ids))

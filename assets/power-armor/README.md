# Картинки силовой брони

Положите сюда файл с именем костюма латиницей — и следующая сборка исходников
подставит его сам. Так картинка переживает и пересборку компендиума, и
обновление модуля; правка портрета прямо в игре живёт только до первой
пересборки пака.

Имена файлов — те же, что у исходников в `sources/addenda-actors/`:

| Костюм | Имя файла |
|---|---|
| Arasaka Neo Guardian | `arasaka-neo-guardian` |
| Arasaka Neo Standard | `arasaka-neo-standard` |
| Arasaka Shin DaiOni | `arasaka-shin-daioni` |
| BlueRaven «Sewer Rat» | `blueraven-sewer-rat` |
| MetaCorp Nyx | `metacorp-nyx` |
| Militech Commando | `militech-commando` |
| СовОйл Бомбардир | `sovoyl-bombardir` |
| Tsunami Arms Magus | `tsunami-arms-magus` |
| Zetatech Grasshopper | `zetatech-grasshopper` |
| Zhirafa Борис | `zhirafa-boris` |

Расширение любое из тех, что понимает Foundry: `webp`, `png`, `jpg`, `jpeg`,
`avif`, `gif`, `svg`. Если файлов несколько, берётся первый по этому порядку —
`webp` предпочтительнее, он легче.

Токен по умолчанию берёт ту же картинку, что и портрет. Нужен отдельный —
положите файл с приставкой `-token`, например `zhirafa-boris-token.webp`.

Костюм без своего файла остаётся с общей иконкой снаряжения — это не ошибка.

После добавления файлов:

    python tools/import_power_armor.py
    node tools/build-packs.js      # при закрытом Foundry

## Готовые картинки

Двадцать файлов здесь — портреты и токены всех десяти комплектов. Исходники
приходили по 2048×2048 (портреты JPEG по 2–3 МБ, токены PNG по 5 МБ) и весили
77 МБ на всех. В модуле они лежат в webp: портрет до 1024, токен до 512 — 3,1 МБ
вместо 77 при том же виде на экране, потому что портрет на листе показывается
сотнями точек, а токен на столе и того мельче.

Пересобрать из исходников:

    python tools/import_power_armor_art.py "путь/к/папке/с/картинками"

Соответствие имён файлов задано в самом инструменте вручную: у присланных
исходников свои написания («Standart», «SovOil Bombarder», «ZHIRAFA»).

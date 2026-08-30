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

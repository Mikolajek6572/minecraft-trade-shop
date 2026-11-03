# Minecraft Trade Shop

Barterowy cennik Minecrafta – przedmiot za przedmiot, bez prawdziwych pieniędzy.

- **Strona:** https://mikolajek6572.github.io/minecraft-trade-shop/
- **Panel admina:** https://mikolajek6572.github.io/minecraft-trade-shop/admin.html
- **API:** https://minecraft-trade-shop.mikolaj1657.workers.dev

Strona (HTML/CSS/JS) leży na **GitHub Pages**, a dane i logowanie obsługuje **Cloudflare Worker + baza D1**.
GitHub Pages nie umie odpalić serwera ani bazy, dlatego backend jest osobno, na Cloudflare (darmowy plan wystarczy).
Zmiany w panelu admina zapisują się w bazie i od razu widzi je każdy odwiedzający.

## Struktura projektu

```
MinecraftTradeShop/
├── docs/                       # strona na GitHub Pages (żadnych haseł ani kluczy)
│   ├── index.html              # publiczny cennik
│   ├── admin.html              # panel admina
│   ├── css/style.css, css/admin.css
│   └── js/
│       ├── config.js           # adres API (workera)
│       ├── common.js           # wspólne: API, ikony, kopiowanie, powiadomienia
│       ├── app.js              # cennik: szukanie, kategorie, sortowanie, zestawy
│       └── admin.js            # panel admina
└── worker/                     # backend na Cloudflare
    ├── wrangler.toml           # konfiguracja workera i bazy D1
    ├── migrations/
    │   └── 0001_init.sql       # schemat bazy + cennik startowy + Diamentowy set
    ├── scripts/create-admin.js # tworzenie admina / reset hasła
    └── src/
        ├── index.js            # trasy API, CORS, ikony z cache
        ├── catalog.js          # logika cennika i walidacja
        └── auth.js             # hasła PBKDF2, sesje, limit logowań
```

## Baza danych (Cloudflare D1)

| Tabela | Co trzyma |
|---|---|
| `categories` | kategorie (nazwa, ikona, kolejność) |
| `items` | przedmioty (nazwa, ikona, kategoria, opis, widoczność) |
| `item_prices` | cena przedmiotu – **kilka wierszy = kilka przedmiotów w cenie** |
| `bundles`, `bundle_items`, `bundle_prices` | zestawy i rabaty (np. Diamentowy set: 22 zamiast 24 Diamond) |
| `admins` | konta adminów (hasło tylko jako hash PBKDF2) |
| `sessions` | aktywne sesje (w bazie tylko hash tokenu) |
| `login_attempts` | limit błędnych logowań |
| `conversations`, `messages` | czat z graczami (+ notatka admina, czy asystent odpowiada) |
| `orders` | zamówienia: nick, pozycje z cenami z chwili zamówienia, suma, natychmiastowa dostawa, status |
| `rate_limits` | limity spamu (zamówienia, czat) |
| `settings` | ustawienia, np. nazwa sklepu |

Kopia zapasowa: w folderze `worker` uruchom `npm run backup` (zapisze `backup.sql`).

## Konfiguracja administratora

Pierwsze konto (albo reset hasła) robisz z konsoli. Potrzebny jest Node.js i zalogowany wrangler (`npx wrangler login`):

```bash
cd worker
```

```bash
npm install
```

```bash
npm run admin -- twoj_login
```

Skrypt zapyta dwa razy o hasło (min. 10 znaków, nie widać go przy pisaniu).
Hasło jest hashowane na Twoim komputerze – do Cloudflare trafia tylko hash.
Ta sama komenda na istniejącym loginie zmienia hasło i wylogowuje wszystkie jego sesje.

Potem wchodzisz na `admin.html` i się logujesz. Hasło zmienisz też w panelu: **Ustawienia → Zmień hasło**.

### Bezpieczeństwo

- W kodzie strony nie ma żadnych haseł ani kluczy. Hasła w bazie są tylko jako hash PBKDF2-SHA256 (100 000 iteracji, sól).
- Po zalogowaniu przeglądarka dostaje losowy token sesji (ważny 12 h), wysyłany w nagłówku `Authorization`.
- Zmiany przyjmowane są tylko z adresów z `ALLOWED_ORIGINS` (CORS) i tylko z ważnym tokenem.
- Limit: 8 błędnych logowań na 15 minut z jednego IP.
- Wszystkie dane są walidowane na serwerze, a w HTML-u escapowane. Strona ma Content-Security-Policy bez inline JS.

## Zamówienia i czat

**Dla graczy (strona):**
- Przycisk **Zamów** przy każdym przedmiocie i zestawie dodaje go do **koszyka** (prawy dolny róg).
- W koszyku trzeba wpisać **nick z Minecrafta** – bez niego zamówienie nie przejdzie. Nick się zapamiętuje.
- **Natychmiastowa dostawa** – opcja z dopłatą (ustawiasz w panelu, domyślnie 5 Iron Ingot). Takie zamówienie świeci się w panelu na złoto, a nad zakładkami miga pasek „kliknij i działaj”.
- Zakładka **Moje zamówienia** pokazuje numer i aktualny status każdego zamówienia z tego urządzenia.
- **Czat** – gracz podaje nick i pisze. **Asystent AI** (Cloudflare Workers AI, model Llama) od razu odpowiada na pytania o ceny – zna cały cennik, ale nie może nic zmieniać ani zamawiać. Gracz widzi, czy admin jest online.

**Dla admina (panel):**
- **Zamówienia:** statystyki (nowe, pilne, dzisiaj, najczęściej zamawiane), filtry, wyszukiwarka, przyciski statusów (Przyjmij → Dane – gotowe / Anuluj), kopiowanie nicku, notatka do każdego zamówienia, głowa gracza.
- **Czat:** lista rozmów z nieprzeczytanymi, odpowiadanie, szybkie odpowiedzi („Już daję!”), **notatka – co chce kupić**, lista zamówień tego gracza. Gdy odpiszesz, asystent w tej rozmowie milknie (włączysz go z powrotem przełącznikiem).
- Panel sam się odświeża co 5 s, **piszczy** przy nowym zamówieniu lub wiadomości (pilne zamówienie = głośny alarm), a w tytule karty widać licznik.
- Zmiana statusu zamówienia sama pisze graczowi w czacie, jeśli go ma.
- **Ustawienia:** włączanie natychmiastowej dostawy i jej dopłata, włączanie asystenta AI, dźwięk.

Ochrona przed spamem: max 10 zamówień na godzinę z jednego IP, limit wiadomości w czacie i nowych rozmów.
Asystent korzysta z darmowego limitu Workers AI – gdy się skończy, gracz dostaje info, że admin odpisze.

## Panel admina – co umie

- **Przedmioty:** dodawanie, edycja, usuwanie, zmiana nazwy, ukrywanie, wyszukiwarka, filtr kategorii.
  Pola: nazwa, cena, przedmiot, którym płacimy, ikona, kategoria (+ opis).
  *+ Dodaj przedmiot do ceny* – kilka przedmiotów jako cena jednego produktu.
  Zmiana nazwy przedmiotu sama poprawia ceny innych przedmiotów, które nim płaciły.
- **Zestawy i rabaty:** przedmioty + ilości + cena zestawu. Rabat liczy się sam i pokazuje na stronie jako *Oszczędzasz X*.
- **Kategorie:** dodawanie, zmiana nazwy i ikony, usuwanie (przedmioty zostają bez kategorii).
- **Ustawienia:** nazwa sklepu, zmiana hasła.

### Ikony

- Puste pole = ikona dobierana z angielskiej nazwy (`Golden Apple` → `Invicon_Golden_Apple.png` z Minecraft Wiki).
- `mc:Nazwa_Ikony` – dowolna ikona z Minecraft Wiki, np. `mc:Enchanted_Golden_Apple`.
- `https://...` – własny obrazek.
- Worker pobiera ikony z wiki i trzyma je w cache Cloudflare. Gdy ikony nie ma, pokazuje się placeholder z inicjałami.

## Uruchomienie lokalnie

Na `localhost` strona sama łączy się z lokalnym workerem (`http://localhost:8787`) i lokalną bazą.

W folderze `worker` (każda komenda osobno):

```bash
npm install
```

```bash
npm run db:init-local
```

```bash
npm run admin -- test --local
```

```bash
npm run dev
```

W drugiej konsoli, w głównym folderze projektu:

```bash
python -m http.server 5500 --directory docs
```

Strona: http://localhost:5500 · Panel: http://localhost:5500/admin.html

## Publikacja od zera (np. na innym koncie)

1. **Backend:** w folderze `worker`:
   - `npx wrangler login`
   - `npx wrangler d1 create minecraft-trade-shop` i wpisz zwrócone `database_id` do `wrangler.toml`
   - `npm run db:init` (tworzy tabele i cennik startowy)
   - `npm run deploy` (pokaże adres workera)
   - `npm run admin -- twoj_login`
2. **Adresy:** wpisz adres workera w `docs/js/config.js` i w `connect-src` w tagu CSP w `docs/index.html` i `docs/admin.html`.
   W `wrangler.toml` w `ALLOWED_ORIGINS` wpisz adres swojej strony (np. `https://twojnick.github.io`) i zrób `npm run deploy`.
3. **Strona:** wrzuć repo na GitHuba, a potem *Settings → Pages → Deploy from a branch → `main` / `docs`*.

Każda zmiana w `docs/` wypchnięta na `main` sama aktualizuje stronę. Zmiany w `worker/` wdrażasz przez `npm run deploy`.

## API

| Metoda | Adres | Dostęp |
|---|---|---|
| GET | `/api/catalog` | każdy |
| GET | `/icons/<Nazwa>.png` | każdy |
| POST | `/api/auth/login`, `/api/auth/logout` | strona z `ALLOWED_ORIGINS` |
| GET | `/api/auth/me` | admin |
| POST | `/api/auth/password` | admin |
| GET | `/api/admin/catalog` | admin (z ukrytymi pozycjami) |
| POST / PUT / DELETE | `/api/admin/items[/:id]`, `/categories[/:id]`, `/bundles[/:id]` | admin |
| PUT | `/api/admin/settings` | admin |
| POST | `/api/orders` | strona (nick wymagany) |
| GET | `/api/orders/<numer>` | strona – status zamówienia |
| POST | `/api/chat/start`, GET/POST `/api/chat/messages` | strona (token rozmowy w `X-Chat-Token`) |
| GET | `/api/admin/inbox`, `/api/admin/orders` | admin |
| PUT / DELETE | `/api/admin/orders/:id` | admin |
| GET / PUT / DELETE | `/api/admin/conversations/:id`, POST `.../messages` | admin |

## Dodawanie nowych funkcji

- Nowa tabela lub kolumna → nowy plik `worker/migrations/0002_cos.sql`, potem `npm run db:init`. Stare dane zostają.
- Nowa logika danych → funkcja w `worker/src/catalog.js` (albo nowy moduł obok).
- Nowy typ danych z dodawaniem, edycją i usuwaniem → dopisz go do `adminResources` w `worker/src/index.js`.
- Nowa trasa API → `if` w funkcji `route` w `worker/src/index.js`. Wszystko po sprawdzeniu sesji jest tylko dla admina.
- Frontend → `docs/`, wspólne rzeczy w `docs/js/common.js`.

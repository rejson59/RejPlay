# RejPlay

Przeglądarkowy prototyp platformy do grania w małe gry 3D. Bez instalacji, bez
konta i bez backendu — statyczna aplikacja Vite + Three.js z jednym
współdzielonym kontekstem WebGL.

W tym slice'u jest **dokładnie jedna gra** (*Demonofobia*) i jedno wspólne lobby
3D (*Atrium*). Nie ma katalogu wielu światów, zapowiedzi gier, karuzeli ani
dodatkowych wygenerowanych okładek. W `public/art/` jest jeden plik:
`house.jpg`, używany przez kafelek gry i baner. Usunięto też zmyślone metryki
(„ponad 200 osób gra aktualnie”, oceny, znajomi online) oraz awatary z kulek.

---

## Co działa teraz

### Strona główna

Neutralny, platformowy ekran — klimat horroru pojawia się wyłącznie w kafelku
gry, nigdy w tle całej strony.

- górny pasek: wyszukiwarka (`/` focus), nick, własne **logo SVG** (nie literka
  „R”), **przełącznik trybu ciemnego**, **przechwytywanie dłoni** i wejście do
  lobby,
- lewy pasek: nawigacja, skrót do samouczka, lista „Boty demonstracyjne”,
- baner *Demonofobia* z przyciskami `Graj teraz` i `Samouczek`,
- sekcja **„Ostatnio odwiedzane”** — zapisuje 2 ostatnie pozycje (gra / lobby) w
  `localStorage` (`rejplay:recent`),
- jeden kafelek gry + osobny kafelek lobby jako punktu zbiórki, bez liczników
  graczy i ocen,
- podgląd postaci na żywo, szybka konfiguracja nicku i akcentu kolorystycznego,
- blok „Jak to działa”.

**Tryb ciemny** nadpisuje zmienne kolorów (pełnoekranowe lobby, gra i edytor są
ciemne domyślnie). Wybór zapisuje się w `localStorage` pod kluczem
`rejplay:theme`; `<meta name="theme-color">` aktualizuje się razem z motywem.
Skrypt motywu i krytyczny CSS są w `<head>`, a arkusz jest wstrzykiwany przez
Vite jako zwykły `<link>` — dzięki temu nie ma już sekundy strony bez CSS
(FOUC). Ekran startowy z logo zasłania scenę do momentu załadowania modeli.

### Samouczek

Siedmiokrokowy modal dostępny z górnej części strony, lewego paska, baneru oraz
ekranu startowego gry. Nawigacja: `Dalej` / `Wstecz`, kropki, klikanie w listę
kroków, strzałki `←` `→` i `Esc`. Ilustracje są czystym CSS i tekstem — nie ma
w nich żadnych generowanych obrazów. Przejście lub pominięcie zapisuje
`rejplay:tutorial`, a przycisk zmienia się w „Powtórz samouczek”.

Kroki: ruch bez blokady kursora → trzy narzędzia → skanowanie `E` →
foto-dowód `P` → nalot → notatnik `J` → raport i wyjście.

### Edytor postaci

`Edytor` w górnym pasku, `Edytuj postać` na stronie głównej lub `Edytuj wygląd`
na podglądzie. Zmiany widać natychmiast i zapisują się w `localStorage`
(`rejplay:appearance`). **Przeciąganie podglądu obraca samą postać** — kamera i
światła stoją nieruchomo, więc to nie wygląda już jak przesuwanie lampy.

| Grupa | Opcje |
| --- | --- |
| Sylwetka i fryzura | **13 gotowych postaci Rocketbox: 9 męskich + 4 żeńskie** (Marek, Tomek, Adam, Bruno, Czesław, Damian, Eryk, Filip, Gustaw, Alicja, Ewa, Nina, Iza) |
| Odcień skóry | 6 tonów, od bardzo jasnej do ciemnej |
| Kolor włosów | czarny, ciemny brąz, brąz, blond, rudy, siwy |
| Ubranie | **8 gotowych strojów z tej samej paczki Rocketbox** |

**Ubrania nie są rzeźbione ręcznie.** Wcześniejsza próba dorabiania geometrii
(kaptury, kołnierze) dawała kartonowe, z-fightujące nakładki zasłaniające głowę,
więc została usunięta (`src/garments.ts` nie istnieje). Zamiast tego podmieniamy
**oryginalne, profesjonalne tekstury korpusu** (`*_body_color.jpg` +
`*_body_normal.jpg`) z innych wariantów Rocketbox: polo w paski, koszula,
wełniany komplet z kamizelką, kamizelka taktyczna, czarny garnitur, brązowa
kurtka robocza, niebieska kurtka ratownika z odblaskami, czarny żakiet.
Szkielet, UV, głowa i fryzura zostają nietknięte, więc strój zawsze leży na
sylwetce. To jest prawdziwa zmiana ubioru, a nie kolorystyczna nakładka.

**Kolor włosów działa na całej głowie.** Paczka ma fryzurę wypieczoną w dwóch
miejscach: w teksturze głowy (`*_head_color.jpg`) i na kartach alpha
(`*_opacity_color.png`). Zmiana samego `material.color` barwiła tylko karty,
zostawiając brąz na czubku głowy. Teraz `src/human.ts` buduje maskę fryzury i
skóry w canvas, normalizuje jasność wypieczongo rysunku kosmyków i przelicza
całą teksturę głowy pod wybrany odcień — blond jest naprawdę blond, czerń
naprawdę czarna. Karty alpha są zamieniane na skalę szarości i barwione tym
samym kolorem. Odcień skóry jest liczony analogicznie, z zachowaniem cieni i
detali twarzy.

### Przechwytywanie dłoni (kamerka, nie tryb kamery w grze)

`Kamerka` w górnym pasku / lobby uruchamia **prawdziwe `getUserMedia` +
MediaPipe Hands** i rysuje szkielet dłoni na `<canvas>` nad podglądem wideo.
Rozpoznawane gesty: otwarta dłoń, pięść, kciuk w górę, wskazywanie, „peace” —
odpowiadają emotom postaci (`machanie`, `kciuk`, `pokazanie`, `peace`, `pięść`)
z krótkim cooldownem. Nic nie jest wysyłane na serwer: model, WASM i pliki danych
leżą lokalnie w `public/mediapipe/` i nie ma żadnego CDN. Kamerę można wyłączyć
przyciskiem, `Esc` lub przy wejściu do gry.

To **nie** jest wirtualny aparat / tryb kamery w grze — tamten (`C`) został
usunięty na wyraźne życzenie. Jedynym zdjęciem w rozgrywce jest `P`
(**foto-dowód**), które zapisuje klatkę jako PNG i jest częścią mechaniki.

### Lobby `Atrium`

Spokojna, filmowa scena: ziarnisty beton, ciepłe latarnie, zimne światło
księżyca, kamienny obelisk i brama z plakatem. `Demonofobia · graj` uruchamia
dochodzenie. Lobby nie jest osobną grą w katalogu.

- 5 postaci (Ty + 4 boty demo), lista graczy, demo czatu,
- `WASD` / strzałki, `Spacja` (skok), przeciąganie myszą (kamera), sterowanie
  dotykowe,
- `E` lub **Machaj** — emote bez VR, oraz gesty z kamerki.

### Demonofobia — jedyna grywalna gra

**Oryginalna, autorska gra dochodzeniowa.** Nie używamy nazwy *Phasmophobia*,
jej duchów, lore'u, interfejsu, dźwięków ani assetów Kinetic Games. Wszystkie
nazwy, opisy zjaw, dowody, dźwięki (synteza WebAudio) i geometria domu są
napisane od zera. Podobieństwo dotyczy **mechaniki gatunku**: first-person,
ręczne zbieranie dowodów narzędziami, dedukcja typu zjawy z zestawu śladów,
notatnik z raportem, narastające zagrożenie i ucieczka. Tytuł *Demonofobia*
został wybrany na wyraźne życzenie, gdy odmówiliśmy użycia chronionej nazwy.

Pierwszoosobowe dochodzenie w domu przy Wrzosowej 12: cztery pokoje, korytarz,
latarka, trzy narzędzia i sześć autorskich typów zjaw.

| Element | Opis |
| --- | --- |
| Narzędzia | `1` Termometr · `2` Miernik pola · `3` Rejestrator |
| Skan | przytrzymaj `E` przez ~1,2 s — `wykryto` albo `brak śladu` |
| Dowody | Zimny punkt, Zakłócenia pola, Szepty |
| Zjawy | Mara, Iskra, Szron, Cisza, Popiół, Nić — 6 różnych zestawów śladów (także jednośladowe) |
| Foto-dowód | `P` zapisuje klatkę jako PNG; przy silnym odczycie uspokaja nerwy, w trakcie nalotu przerywa go |
| Nalot | co ~30–48 s zjawa podąża korytarzem, światło migocze, nerwy spadają szybciej; wyjście frontowymi drzwiami, zdjęcie `P` lub przeczekanie kończy nalot |
| Nerwy | maleją z czasem, szybciej po ciemku, podczas zjawisk i nalotu |
| Raport | `J` / `Tab` → wybierz zjawę zgodną ze śladami; pomyłka kosztuje 24 nerwy |

Sterowanie: `WASD` + mysz (`movementX/Y`, bez pointer locku — HUD pozostaje
klikalny), `Shift` bieg, `F` latarka, `Esc` / `← Wyjdź` powrót. Na dotyku działa
joystick i przyciski `Skanuj`, `Narzędzie`, `Notatnik`, `Latarka`.

---

## Sterowanie — skrót

| Klawisz | Akcja |
| --- | --- |
| `/` | focus na wyszukiwarce (strona główna) |
| `W A S D`, strzałki | ruch w lobby i w grze |
| `Spacja` | skok w lobby |
| `E` | machnięcie (lobby) / skanowanie, przytrzymaj (gra) |
| `1` `2` `3` | wybór narzędzia (gra) |
| `P` | foto-dowód → zapis PNG (gra) |
| `F` | latarka (gra) |
| `J` / `Tab` | notatnik (gra) |
| `Shift` | bieg (gra) |
| `Esc` | zamknięcie kamerki / samouczka / edytora / wyjście z gry / powrót na stronę główną |

---

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # dist/
npm run preview
```

Wymagany Node 20+. Modele 3D, tekstury, pliki MediaPipe i jedyna grafika są w
`public/`, więc aplikacja nie pobiera niczego z zewnętrznych CDN w trakcie
działania. Kamerka wymaga zgody przeglądarki na `getUserMedia` i bezpiecznego
kontekstu (`localhost` lub HTTPS).

---

## Struktura

```
index.html            strona główna, lobby, gra, edytor, samouczek, logo SVG, boot overlay
src/style.css         jasny/ciemny katalog + ciemne widoki pełnoekranowe
src/main.ts           stan UI, motyw, samouczek, HUD gry, kamerka, boot
src/games.ts          jedna gra + lobby, 13 modeli, 8 gotowych strojów, paleta, boty
src/world.ts          jeden renderer, 3 sceny (home / lobby / gra), kamery, input
src/character.ts      slot gracza: rigowana postać + neutralny zastępnik
src/human.ts          13 GLB Rocketbox, maski głowy, podmiana tekstur ubioru, animacje
src/hand-tracking.ts  getUserMedia + MediaPipe Hands, klasyfikacja gestów, szkielet
src/avatar.ts         wspólny interfejs awatara i etykiety
src/horror.ts         Demonofobia: geometria domu, silnik, nalot, dźwięk
public/characters/    13 GLB + 2 biblioteki animacji + gotowe tekstury + licencja MIT
public/mediapipe/     lokalne pliki MediaPipe Hands (WASM, dane, model)
public/art/           house.jpg — jedyna okładka, dla jedynej gry
```

---

## Assety i licencje

- **Postacie i ubrania**: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
  — MIT, `Copyright (c) 2020 Microsoft`. GLB i tekstury pochodzą z konwersji w
  repozytorium `KunalSiyag/gridfall` (MIT), które w `PROVENANCE.json` wskazuje na
  commit Rocketbox `0943055…`. Pełna treść licencji:
  `public/characters/LICENSE-rocketbox-MIT.txt`. Gotowe tekstury strojów są
  częścią tej samej paczki — nie dorabiamy własnych meshów ubrań.
- **Kamerka / gesty**: `@mediapipe/hands` 0.4.1675469240 (Apache-2.0), pliki
  skopiowane do `public/mediapipe/` (warianty SIMD i fallback; nota licencyjna
  w `public/mediapipe/NOTICE.txt`). Żadnych requestów do zewnętrznych CDN.
- **Grafika**: `public/art/house.jpg` to jedyna wygenerowana ilustracja,
  używana przez kafelek i baner *Demonofobia*. Pozostałe okładki usunięto.
- **Dźwięki** w grze są syntetyzowane w locie (`AudioContext`), bez plików audio.
- Three.js, Vite i TypeScript — własne licencje open source w `node_modules`.

### Uczciwie o „realistycznych postaciach”

| Mamy | Czego nie mamy |
| --- | --- |
| 13 rigowanych, teksturowanych sylwetek 1,75 m, mapy albedo/normal/alpha | Skanu fotogrametrycznego konkretnej osoby |
| 8 gotowych, profesjonalnych strojów z tej samej paczki | Systemu warstw ubioru / fizyki tkanin |
| Animacje motion capture: idle, chód, machanie + 5 emote'ów z gestów | Mimiki twarzy i pełnego trackingu palców |
| Kolor skóry i włosów liczony na całej głowie (maska fryzury) | Pełnego kreatora twarzy, wagi, wieku |
| Jeden wspólny renderer i PBR-owe światła | Metahuman / silnika typu Unreal w przeglądarce |

---

## Roadmapa (poza tym slice'm)

- Prawdziwe pokoje multiplayer zamiast botów,
- profile, znajomi i zapis postaci w bazie,
- edytor świata i piaskownica UGC z bezpiecznym skryptowaniem,
- fizyka (Rapier), system osiągnięć,
- optymalizacja: LOD modeli, code-splitting Three.js, lazy load sceny gry.

Wspomniany luźno „CS” nie został dodany: na tym etapie jest jedna gra, a
dokładny zakres ewentualnego nowego tytułu wymaga doprecyzowania. Kolejne gry
powstaną dopiero na wyraźne życzenie — jako osobne sceny, nie jako motyw
przewodni całej strony.

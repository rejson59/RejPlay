# RejPlay

Przeglądarkowa platforma 3D: **jedna autorska gra** (*Demonofobia*) i jedno
wspólne lobby (*Atrium*). Frontend jest w pełni statyczny (Vite + Three.js,
jeden kontekst WebGL) i działa na **GitHub Pages**. Multiplayer, czat i profile
korzystają z istniejącego projektu **Supabase `rejson-widgets`** — nie mamy
własnego serwera, ale gra bez połączenia z bazą nadal działa lokalnie.

Nie ma katalogu wielu światów, zapowiedzi gier, karuzeli ani zmyślonych metryk.
W `public/art/` jest jeden plik: `house.jpg` (kafelek gry i baner).

---

## Co działa teraz

### Strona główna

Nowoczesny, jasny ekran (ciemny motyw nadpisuje zmienne kolorów). Klimat horroru
pojawia się wyłącznie w kafelku gry, nigdy w tle strony.

- górny pasek: wyszukiwarka (`/` focus), nick, logo SVG, tryb ciemny,
  **wskaźnik połączenia z Supabase**, śledzenie dłoni i wejście do lobby,
- duży nagłówek, trzy karty „Wspólne Atrium / Dłonie 1:1 / Realistyczne
  rekwizyty”,
- panel **„Na żywo”** w lewym pasku: prawdziwa lista graczy z Realtime Presence,
- baner *Demonofobia*, „Ostatnio odwiedzane”, kafelek gry i kafelek lobby,
- podgląd postaci na żywo, szybka konfiguracja nicku i akcentu,
- blok „Jak to działa”.

Wybór motywu zapisuje się w `localStorage` (`rejplay:theme`). Skrypt motywu i
krytyczny CSS są w `<head>`, więc nie ma FOUC; ekran startowy zasłania scenę do
momentu załadowania modeli.

### Samouczek

Siedmiokrokowy modal (strona główna, lewy pasek, baner, start gry). Nawigacja:
`Dalej` / `Wstecz`, kropki, strzałki, `Esc`. Ilustracje to czysty CSS i tekst.

Kroki: ruch bez blokady kursora → trzy narzędzia → skanowanie `E` →
foto-dowód `P` → nalot → notatnik `J` → raport i wyjście.

### Edytor postaci

Zmiany widać natychmiast w podglądzie, lobby **i w dłoniach first-person**;
zapisują się w `localStorage` (`rejplay:appearance`). Przeciąganie obraca samą
postać — kamera i światła stoją nieruchomo.

| Grupa | Opcje |
| --- | --- |
| Sylwetka | **13 postaci Rocketbox: 9 męskich + 4 żeńskie** (Marek…Gustaw, Alicja, Ewa, Nina, Iza) |
| Odcień skóry | 6 ciepłych tonów; **domyślnie „Średnia”** dla wszystkich postaci, botów i dłoni w grze |
| Kolor włosów | czarny, ciemny brąz, brąz, blond, rudy, siwy |
| Ubranie | **8 gotowych strojów**, każdy w wariancie męskim i damskim |

**Naprawione błędy wszystkich postaci żeńskich.** Damskie i męskie korpusy
Rocketbox mają **różny układ UV** (u kobiet ręce są u góry atlasu, nogi na dole).
Wcześniej każdy strój nakładał teksturę męską, co dawało „pończochy z rękawów”,
skórzane łaty na łydkach i czarne plamy na łokciach. Teraz `OutfitDef` ma
`bodyFemale`, a `src/human.ts` wybiera wariant dla płci modelu. Poprawiono też
maskę fryzury: jasny blond był wcześniej klasyfikowany jako skóra, więc głowa
wyglądała na łysą. Maska rozróżnia odcień czerwono-różowy (skóra) od żółtego
(włosy) i ogranicza przebarwienie strefami UV, zostawiając oczy, usta i kartę
oka.

**Kolor skóry obejmuje dłonie.** Odkryta skóra jest w teksturze *body*, nie
tylko *head*. `bodyTexture()` przelicza ją pod wybrany odcień z płynnym
przejściem (bez „opasek” na przedramieniu), zachowując cieniowanie i paznokcie.
Ubrania nie są przebarwiane — środek atlasu jest wyłączony z maski.

**Ubrania nie są rzeźbione ręcznie.** Podmieniamy wyłącznie oryginalne tekstury
korpusu (`*_body_color.jpg` + `*_body_normal.jpg`) z innych wariantów Rocketbox.
Szkielet, UV, głowa i fryzura zostają nietknięte. Wcześniejsza próba dorabiania
geometrii (`src/garments.ts`) została usunięta.

### Śledzenie dłoni 1:1 (kamerka, nie tryb kamery w grze)

`Dłonie 1:1` uruchamia **`getUserMedia` + MediaPipe Hands** i rysuje szkielet
obu dłoni na `<canvas>` nad podglądem.

**To nie jest rozpoznawanie gestów ani odtwarzanie animacji.** Model zwraca 21
punktów 3D na dłoń; `src/hand-pose.ts` liczy z nich **kąty zgięcia 15 stawów**
(5 palców × 3 ogniwa), rozstawienie, roll, pitch, yaw oraz **pozycję nadgarstka
w 3D** (x / y / głębokość z punktu 0). `src/human.ts` odwzorowuje kąty na kości
`Bip01_*_Finger*` awatarów, a `src/view-hands.ts` na dłonie first-person.
Poruszenie jednym palcem przed kamerą porusza tym samym palcem awatara —
z wygładzaniem, bez cooldownu, bez „wykrytego gestu”. Przesunięcie dłoni w
kadrze przesuwa całą dłoń awatara w lewo/prawo, górę/dół i bliżej/dalej kamery.

**Dłonie first-person to oryginalne dłonie awatara.** Nie ma już osobnego
proceduralnego viewmodelu z kapsułek. `AvatarViewHand` klonuje rigowany
`SkinnedMesh` wybranej postaci, wycina z niego trójkąty przypisane do kości
przedramienia / nadgarstka / palców, ustawia go przed kamerą i steruje tymi
samymi 15 stawami. Skóra, paznokcie, rękawy i proporcje palców są identyczne z
postacią w lobby i zmieniają się razem z edytorem. Jeśli GLB nie wczyta się
wcale, działa lekki `FallbackViewHand`.

MediaPipe: `maxNumHands: 2`, `modelComplexity: 1`, pliki WASM/dane leżą lokalnie
w `public/mediapipe/` (zero CDN, zero danych opuszcza przeglądarkę). W grze panel
kamerki się chowa, ale **tracking działa dalej**. To **nie** jest wirtualny
aparat / tryb kamery (`C` usunięty); jedynym zdjęciem jest `P` (foto-dowód).

**Realizm ruchu dłoni (v0.4).** Surowe kąty z 21 punktów przechodzą przez
wiązadłowy model palca: DIP jest częściowo sprzężony z PIP, sąsiednie palce
lekko pociągają się przy zaciskaniu, a kciuk ma własne osie i limity. Do tego
`HandAnimator` używa **SmoothDamp** (stabilny nawet przy 2–3 klatkach na
sekundę), mikro-drżenia przy bezruchu, opóźnienia nadgarstka i chwytu
spoczynkowego, gdy dłoń znika z kadru — nie ma już zamrożonej ani nagle
otwartej dłoni. Narzędzie i dłonie reagują z opóźnieniem na obrót głowy, skan
i bieg.

### Płynność, telefony i tablety (v0.4)

`src/performance.ts` mierzy średni czas klatki (EMA, z histerezą i ignorowaniem
przerw > 250 ms po powrocie z innej karty) i dobiera profil: `oszczędna`
(DPR ≤ 1, bez cieni, bez kurzu/ziarna, limit 45 fps, bez MSAA), `wysoka` i
`auto`. W górnym pasku **„Jakość”** można wymusić profil; wybór zapisuje się w
`localStorage` (`rejplay:quality`). Słabe urządzenia startują bez antyaliasu i z
lżejszą kamerą MediaPipe (480×360 / 24 fps / `modelComplexity: 0`).

Żeby nie było przycięć:

- brak alokacji w pętli (wspólne wektory i kwaterniony, stany animacji bez
  tworzenia obiektów na klatkę),
- `preserveDrawingBuffer: false` — `capturePhoto()` robi własny, jawny render
  dopiero w momencie zdjęcia,
- `IntersectionObserver` pomija render home, gdy scena jest poza ekranem,
- kurz aktualizuje się najwyżej 30×/s, migotanie świateł tylko przy zmianie
  stanu, 8 rekwizytów CC0 ładuje się równolegle jednym `Promise.all()`,
- bufor, cienie i materiały zmieniają się wyłącznie przy zmianie profilu.

**Dotyk:** `body.has-touch` chowa pasek narzędzi dla klawiatury (dubluje
przyciski), a sześć przycisków akcji ma min. 44×44 px (tablety 52 px) i obsługuje
przytrzymanie (`Bieg`, `Skanuj`). Uwzględniamy `env(safe-area-inset-*)`,
`100dvh` i `touch-action: none`; osobne breakpointy dla pionu, poziomu
≤ 560 px i tabletu w pionie trzymają HUD w górnych rogach, a joystick i przyciski
na dole. Viewmodel dostosowuje FOV, rozstaw i skalę dłoni do proporcji ekranu —
na wąskim telefonie dłonie nie znikają poza kadrem ani nie zasłaniają połowy
ekranu. Hybrydowe wykrywanie dotyku obsługuje też tablety z myszą.

### Lobby `Atrium` i multiplayer

Spokojna, filmowa scena: beton, ciepłe latarnie, księżyc, obelisk, brama.
`Demonofobia · graj` uruchamia dochodzenie. Lobby nie jest osobną grą w katalogu.

- **prawdziwi gracze**: pozycja, obrót, nick, kolor i wygląd awatara przez
  Supabase **Realtime Presence**; obcy awatary są rigowanymi postaciami 3D,
  wygładzanymi interpolacją,
- **wspólny czat** zapisywany w `rejplay_chat` i dostarczany przez
  `postgres_changes` (historia 12 ostatnich wiadomości),
- 4 boty demonstracyjne, lista graczy z odznaką „online”,
- `WASD` / strzałki, `Spacja`, przeciąganie myszą, sterowanie dotykowe,
- `E` / **Machaj** — emote bez VR; kamerka natomiast steruje palcami 1:1.

### Supabase `rejson-widgets`

Projekt `hzbqzfimtroixnldzjeq` (eu-central-1). W frontendzie używamy
**wyłącznie klucza publishable/anon** — `service_role` i sekrety nigdy nie
trafiają do kodu ani do bundla. Konfigurację można nadpisać zmiennymi
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (patrz `.env.example`).

| Tabela | Zawartość |
| --- | --- |
| `rejplay_profiles` | nick, kolor, wygląd JSON, `client_id` z localStorage |
| `rejplay_chat` | wiadomości Atrium (max 180 znaków) |
| `rejplay_events` | `game_open`, `game_start`, `game_win`, `game_fail`, `photo`, `lobby_enter` |

Migracja (RLS dla `anon`, indeksy, dodanie tabel do publikacji
`supabase_realtime`) leży w `supabase/migrations/20261102190000_rejplay_multiplayer.sql`
i została zastosowana w projekcie. **Jeśli baza jest niedostępna**, wskaźnik na
stronie przechodzi w „Tryb offline”, czat zostaje w karcie, a gra, lobby i
kamerka działają normalnie — brak połączenia nie blokuje rozgrywki.

### Demonofobia — jedyna grywalna gra

**Oryginalna, autorska gra dochodzeniowa.** Nie używamy nazwy *Phasmophobia*,
jej duchów, lore'u, interfejsu, dźwięków ani assetów Kinetic Games. Wszystkie
nazwy, opisy zjaw, dowody, dźwięki (WebAudio) i geometria domu są napisane od
zera. Podobieństwo dotyczy **mechaniki gatunku**: first-person, ręczne zbieranie
dowodów, dedukcja typu zjawy, notatnik, narastające zagrożenie, ucieczka.

Pierwszoosobowe dochodzenie przy Wrzosowej 12: cztery pokoje, korytarz, latarka,
trzy narzędzia, sześć zjaw.

**Wygląd i realizm:**

- proceduralne tekstury z canvas (deski ze słojami, tapeta z zaciekami,
  tkanina, glazura, dywan) z mapami wypukłości,
- meble z zaokrąglonych krawędzi i toczenia: stół, krzesła, regał z książkami,
  fotel, łóżko, szafki, zlew, czajnik, wieszak, lustro, zegar, obrazy, kurz,
- **8 gotowych, fotorealistycznych rekwizytów CC0 z Poly Haven** (ławka,
  drewniany stół, donica, paproć, kosz, skrzynka, latarnia, głaz) z wbudowanymi
  teksturami 1K — ładują się asynchronicznie, nie blokują startu gry,
- statyczna geometria łączona wg materiału (`mergeGeometries`),
- latarka z cieniami, księżyc, migotanie, mgła, winyeta i ziarno,
- **oryginalne dłonie awatara** first-person na osobnej scenie z własnym
  światłem + narzędzie z żywym ekranem LCD, sondą/anteną/mikrofonem,
- ruch: bezwładność, wygładzone rozglądanie, kołysanie głowy, przechył,
  kroki zsynchronizowane z krokiem, FOV przy biegu, podniesienie narzędzia przy
  skanie; na dotyku czułość rozglądania jest wyższa, bo palec pokonuje krótszą
  drogę niż mysz.

| Element | Opis |
| --- | --- |
| Narzędzia | `1` Termometr · `2` Miernik pola · `3` Rejestrator |
| Skan | przytrzymaj `E` przez ~1,2 s — `wykryto` albo `brak śladu` |
| Dowody | Zimny punkt, Zakłócenia pola, Szepty |
| Zjawy | Mara, Iskra, Szron, Cisza, Popiół, Nić — 6 zestawów śladów |
| Foto-dowód | `P` zapisuje PNG; przy silnym odczycie uspokaja nerwy, przerywa nalot |
| Nalot | co ~30–48 s; wyjście frontowymi drzwiami, `P` lub przeczekanie kończy go |
| Nerwy | maleją z czasem, szybciej po ciemku, podczas zjawisk i nalotu |
| Raport | `J` / `Tab` → wybierz zjawę; pomyłka kosztuje 24 nerwy |

Sterowanie: `WASD` + mysz (`movementX/Y`, bez pointer locku), `Shift` bieg,
`F` latarka, `Esc` / `← Wyjdź` powrót. Na dotyku: joystick + `Skanuj`, `Bieg`,
`Foto`, `Narzędzie`, `Notatnik`, `Latarka` (przyciski trzymane palcem mają
wizualny stan wciśnięcia).

---

## Sterowanie — skrót

| Klawisz | Akcja |
| --- | --- |
| `/` | focus na wyszukiwarce |
| `W A S D`, strzałki | ruch w lobby i w grze |
| `Spacja` | skok w lobby |
| `E` | machnięcie (lobby) / skanowanie, przytrzymaj (gra) |
| `1` `2` `3` | wybór narzędzia (gra) |
| `P` | foto-dowód → zapis PNG (gra) |
| `F` | latarka (gra) |
| `J` / `Tab` | notatnik (gra) |
| `Shift` | bieg (gra) |
| `Esc` | zamknięcie kamerki / samouczka / edytora (poza grą) · wyjście z gry |

---

## Uruchomienie i wdrożenie

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # dist/ z bazą /RejPlay/
npm run preview
```

Wymagany Node 20+. Wszystkie assety leżą w `public/`, więc aplikacja nie pobiera
niczego z CDN. Kamerka wymaga zgody na `getUserMedia` i bezpiecznego kontekstu
(`localhost` lub HTTPS — GitHub Pages daje HTTPS).

**GitHub Pages:** `.github/workflows/deploy-pages.yml` buduje `npm ci` +
`npm run build` i wdraża `dist/` przez `actions/deploy-pages` do środowiska
`github-pages`. `vite.config.ts` ustawia `base: '/RejPlay/'` dla produkcyjnego
buildu, a moduły ładujące assety używają `import.meta.env.BASE_URL` — dzięki
temu GLB, tekstury, MediaPipe i rekwizyty działają pod
`https://rejson59.github.io/RejPlay/`. Na branchach roboczych workflow robi
tylko build (repozytorium pozwala deployować wyłącznie z `main`). Strona jest
SPA bez routingu po stronie serwera, więc nie potrzebuje `404.html`.

---

## Struktura

```
index.html                     strona główna, lobby, gra, edytor, samouczek, boot overlay
src/style.css                  jasny/ciemny katalog + widoki pełnoekranowe
src/main.ts                    stan UI, motyw, samouczek, HUD, kamerka, online, boot
src/games.ts                   jedna gra + lobby, 13 modeli, 8 strojów (męskie/damskie), boty
src/world.ts                   jeden renderer, 3 sceny + viewmodel, awatary zdalnych graczy
src/performance.ts             adaptacyjna jakość: profile, EMA klatek, DPR, cienie, limit fps
src/character.ts               slot gracza: rigowana postać + zastępnik
src/human.ts                   13 GLB, maski głowy/ubrania, retarget dłoni, kolory skóry
src/hand-tracking.ts           getUserMedia + MediaPipe Hands: 21 punktów obu dłoni
src/hand-pose.ts               21 punktów → 15 kątów, rozstaw, obroty, pozycja nadgarstka 3D
src/view-hands.ts              prawdziwe dłonie awatara (SkinnedMesh) + narzędzie LCD
src/online.ts                  Supabase Realtime Presence / czat / profile / zdarzenia
src/real-props.ts              gotowe rekwizyty CC0 Poly Haven
src/horror-decor.ts            proceduralne tekstury, meble, światła i kurz
src/horror.ts                  Demonofobia: silnik, ruch, nalot, dźwięk, first-person
src/avatar.ts                  wspólny interfejs awatara i etykiety
supabase/migrations/           migracja tabel rejplay_* + RLS + realtime
.github/workflows/             build + deploy na GitHub Pages
public/characters/             13 GLB + animacje + gotowe tekstury + licencja MIT
public/mediapipe/              lokalne pliki MediaPipe Hands
public/assets/props/           8 GLB CC0 + LICENSE-polyhaven-cc0.txt
public/art/                    house.jpg — jedyna okładka
```

---

## Assety i licencje

- **Postacie i ubrania**: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
  — MIT, `Copyright (c) 2020 Microsoft`. GLB i tekstury z konwersji w
  `KunalSiyag/gridfall` (MIT, `PROVENANCE.json` → commit Rocketbox `0943055…`).
  Licencja: `public/characters/LICENSE-rocketbox-MIT.txt`.
- **Realistyczne rekwizyty**: [Poly Haven](https://polyhaven.com) — **CC0 1.0**
  (public domain), pobrane z `models/real/props` w GridFall, z wbudowanymi
  teksturami 1K. Proveniencja: `public/assets/LICENSE-polyhaven-cc0.txt`.
  Nie pochodzą z żadnej komercyjnej gry.
- **Kamerka**: `@mediapipe/hands` 0.4.1675469240 (Apache-2.0), pliki lokalnie w
  `public/mediapipe/` (nota: `public/mediapipe/NOTICE.txt`).
- **Grafika**: `public/art/house.jpg` — jedyna wygenerowana ilustracja. Tekstury
  wnętrza powstają w locie w canvas.
- **Dźwięki**: syntetyzowane `AudioContext`, bez plików audio.
- **Multiplayer**: Supabase (`@supabase/supabase-js`, Apache-2.0) — klucz
  publishable/anon, RLS po stronie bazy.
- Three.js, Vite, TypeScript — własne licencje open source w `node_modules`.

### Uczciwie o „realistycznych postaciach”

| Mamy | Czego nie mamy |
| --- | --- |
| 13 rigowanych, teksturowanych sylwetek 1,75 m, albedo/normal/alpha | Skanu fotogrametrycznego konkretnej osoby |
| 8 strojów w wariantach męskich **i damskich** (poprawne UV) | Systemu warstw ubioru / fizyki tkanin |
| Animacje motion capture: idle, chód, machanie | Mimiki twarzy i trackingu całego ciała |
| Kolor skóry na twarzy i dłoniach, kolor włosów na całej głowie | Pełnego kreatora twarzy, wagi, wieku |
| 21 punktów → 15 stawów + pozycja nadgarstka 3D, 2 dłonie naraz | Śledzenia łokcia i ramion (jest nadgarstek) |
| 8 gotowych modeli CC0 z PBR, jeden renderer, światła PBR | Metahuman / silnika typu Unreal w przeglądarce |
| Auto jakość (DPR, cienie, kurz, fps) i układ dotykowy na telefon/tablet | Profilowania na realnym GPU i fizycznych urządzeniach |
| Prawdziwych graczy, czat i profile w Supabase | Serwerowego autorytatywnego world state / anty-cheat |

---

## Roadmapa (poza tym slice'm)

- autorytatywny stan świata i pokoje z limitem graczy,
- osiągnięcia, znajomi i zapis postępu w bazie,
- edytor świata / piaskownica UGC z bezpiecznym skryptowaniem,
- fizyka (Rapier), LOD modeli, code-splitting sceny gry.

Wspomniany luźno „CS” nie został dodany: jest jedna gra, a zakres ewentualnego
nowego tytułu wymaga doprecyzowania. Kolejne gry powstaną dopiero na wyraźne
życzenie — jako osobne sceny, nie jako motyw przewodni strony.

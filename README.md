# RejPlay

Przeglądarkowa platforma 3D przygotowana na **wiele gier**: pierwszą z nich
jest autorska *Demonofobia*, a wspólnym punktem zbiórki jest park **Lobby**
(dokładnie taka nazwa — bez dopisków i bez „3D”). Frontend jest w pełni
statyczny (Vite + Three.js, jeden kontekst WebGL) i działa na **GitHub Pages**.
Multiplayer, czat i profile korzystają z istniejącego projektu
**Supabase `rejson-widgets`** — nie mamy własnego serwera. **Nie ma trybu
offline**: bez połączenia klient ponawia próby, a czat i Presence czekają na
serwer (nie udajemy lokalnych graczy ani wiadomości „tylko u Ciebie").
**Zagranie wymaga konta.**

Nie ma zapowiedzi gier ani zmyślonych metryk: katalog pokazuje tylko to, co
naprawdę działa. W `public/art/` jest jeden plik: `house.jpg` (kafelek gry).

**v0.9 — pewny STOP, kalibracja punktowa i czyste przejścia:** sterowanie bez
klawiatury nie włącza się już samo (`enabled` nie jest zapisywane, stary wpis z
`localStorage` jest ignorowany), znika stały dryf głowy, a brak twarzy daje
natychmiastowe zero we wszystkich kanałach — także `onControl(0)` w silniku.
Jeden, zawsze dostępny hamulec: przycisk **„Zatrzymaj"** i klawisz **C**.
Dodano kreator **9 punktów na ekranie**: dopasowanie afiniczne spojrzenia
(`src/gaze-calibration.ts`), punkt neutralny głowy i automatyczne wykrywanie
odwróconych osi dłoni (lewo/prawo, góra/dół, przód/tył), z ręcznymi
przełącznikami w laboratorium. W Demonofobii W/dotyk mają pierwszeństwo przed
kanałem z kamerki (`combineMovement()`), ruch próbkuje cały odcinek zamiast
tylko celu, collidery mają widoczne rekwizyty podwórka, a skrzydło drzwi
zostało odsunięte od osi spawnu. Usunięto tryb offline, zmieniono tekst hero,
a lampy w Lobby są normalizowane do rzeczywistego bbox GLB (Khronos
`Lantern.glb` miał 25,66 m × `scale 2.2` = 56 m w parku o promieniu 12 m).
Testy: **82/82** (`npm test`).

**v0.8 — chodzenie, park bez brył i realniejsze dłonie:** naprawiony błąd,
po którym w Demonofobii nie dało się ruszyć z miejsca (gracz rodził się
**wewnątrz** collidera blatu monitoringu, a `yaw = π` przy `yawTarget = 0`
dorzucał obrót kamery o 180° na starcie). Czysta geometria kolizji trafiła do
`src/movement.ts` z testami drogi od samochodu do frontowych drzwi, start
sam wybiera wolne miejsce, a focus w polu tekstowym nie blokuje już WASD.
Park **Lobby** nie ma ani jednej prymitywnej bryły: altana ze stożka, klomby z
kulek, oczko z torusa, tablica z prostopadłościanu i mosiężny zegar zostały
zastąpione gotowymi GLB (fontanna, wiata, billboard „Lobby", ławki, donice,
głazy, roślina PBR, latarnie, stół piknikowy). `park.ts` odpowiada dziś
wyłącznie za teksturowany teren, niebo i światła; portale gier też są
billboardami GLB. Katalog urósł do **120 darmowych modeli w 9 kategoriach** —
dodano 16 modeli GridFall (budynki, pojazdy, most) i 3 fotorealistyczne PBR
z Khronos, z notami licencyjnymi i testem integralności w CI. Dłonie dostały
anatomiczne minima stawów, zależność ścięgnistą nadgarstka (tenodesis),
kaskadę czasową palców oraz stożkowate paliczki z kostkami i opuszkami
w widoku awaryjnym. **50 testów** w `node --test`.

**v0.7.1 — odporność i jakość śledzenia:** cztery realne usterki w torze
kamerki zostały usunięte. Po zniknięciu twarzy `CameraControl` odejmował
neutralną kalibrację od zera, więc postać jechała sama; teraz brak sygnału
jest czymś innym niż sygnał zerowy. Pojedynczy `NaN` z MediaPipe zatruwał
sprężyny `HandAnimator` na zawsze — każda klatka przechodzi teraz przez
`src/tracking-guard.ts`, a integrator sam odtwarza stan. Dłonie i twarz mają
watchdogi, które przy braku odczytu świadomie wracają do spoczynku zamiast
zamarzać; odłączenie kamerki wykrywa tor `ended` i wznawia strumień (max 2
próby). `faceFrameFromLandmarks` wydzielono do czystej, testowalnej
`src/face-math.ts` z adaptacyjną kalibracją mrugnięcia (próg dopasowuje się
do oka użytkownika), a „Kalibruj pozycję neutralną" naprawiono tak, by nie
dokładać skoku ±π do następnej klatki. Start kamerki sprząta strumień i iframe
po błędzie, liczniki diagnostyczne resetują się co sesję, a raport „Kopiuj
logi" ma wersję v0.7.1 i wiek odczytów. Dodano **29 testów jednostkowych**
(`tests/`, wbudowany `node --test`, zero nowych zależności) i wreszcie
**checki na pull requestach**: poprzedni workflow reagował tylko na jeden
historyczny branch, więc PR-y nie miały żadnej weryfikacji. Zapis do czatu,
profili i zdarzeń przeszedł przez RPC z walidacją tokenu (migracja
`20261105000000_rejplay_write_auth.sql`, zastosowana i sprawdzona na bazie:
polityki `SELECT`, bezpośredni `INSERT` jako `anon` odrzucany). Presence ma
jawny numer protokołu, żeby przyszłe zmiany nie rozdzielały klientów.

**v0.7 — park, assety, nowy home i brama konta:** Lobby stało się jasnym
parkiem w świetle dnia (trawnik, okrągła alejka, altana, klomby, oczko wodne,
tablica „Lobby”, brama gry) zamiast nocnego betonowego placu. Biblioteka
darmowych, realistycznych assetów urosła z 25 do **101 modeli w 9 kategoriach**
(meble, postacie, zwierzęta, pojazdy, budynki, roślinność, ulica, przedmioty,
park) — Demonofobia jest tylko jedną z gier, które mają z niej korzystać.
Strona główna została przebudowana: mniej tekstu, 25 ikon SVG, brak
nakładania się sekcji na 390 / 1024 / 1440 px. Dodano **ładny ekran
logowania i rejestracji** (`src/auth-gate.ts`) oraz twardą blokadę: bez konta
nie da się wejść do Lobby ani uruchomić gry. Zero botów — lista graczy to
wyłącznie realne Presence. Przy okazji naprawiono `CommunityAccount.refresh()`:
pierwsze odświeżenie bez sesji zostawiało resolved promise w `pending`, więc
późniejsze logowanie nigdy nie walidowało tokenu.

**v0.5:** pełna pozycja dłoni w 3D (x / y / głębokość) zamiast tylko palców
i drobnych ruchów nadgarstka, first-person w Lobby, przechwycenie kursora
z pełnym obrotem 360° dla wielu monitorów, adaptacyjne wygładzanie i czułość
ruchu do ustawienia na żywo.

**v0.6.1 — naprawa kamerki i nadgarstka:** FaceMesh działa w osobnym,
same-origin iframe (`public/mediapipe/face/bridge.html`), bo oba bundle
MediaPipe nadpisywały sobie globalne zmienne Emscripten w jednym dokumencie —
to było źródłem `Błąd odczytu klatki: TypeError: Cannot read properties of
undefined (reading 'buffer')` oraz braku wykrywania głowy i oczu. first-person
`src/view-hands.ts` dostał wreszcie geometryczne wyznaczanie osi zgięcia
(poprzednia poprawka trafiła tylko do awatara third-person) i prawdziwy,
ciągły obrót nadgarstka na kości `Hand`; stary wzór `atan2(palm.x, -palm.y)`
zawsze dawał po clampie stałą `1`, więc nadgarstek nie reagował. Słabsze
kamerki dostają drabinę `getUserMedia` (640×480 → 320×240 → `video: true`),
niższe progi pewności, mniejszy kadr dla FaceMesh i czytelny status wykrywania.
Dodano **„Kopiuj logi” / „Pokaż logi” / „Restart kamerki”** — raport trafia do
schowka, nie zawiera obrazu, konta, tokenów ani kodu drużyny.

**v0.6 — „VR bez VR”:** jedna kamerka zasila trzy niezależne tory: MediaPipe
Hands (dłonie 1:1) **oraz** FaceMesh z `refineLandmarks` (głowa + źrenice).
**Laboratorium kamery** na starcie robi kalibrację neutralnej pozycji i trzy
testy (dłonie, głowa, oczy); po nich lekki przechył głowy w przód porusza
postacią z prędkością wprost proporcjonalną do kąta, przechył w tył cofa,
przechył na bok strafuje, a źrenice sterują kamerą. Palce chwytają, odkładają
i używają narzędzi z **pasu na biodrach**. Klawiatura, mysz i dotyk zostają
wyłącznie jako zapasowe sterowanie. Do tego: konta współdzielone z
`rejson59.github.io`, drużyny z kodem zaproszenia, zero botów demo, samochód-baza
i 25 darmowych assetów CC0/MIT, 6 narzędzi, 6 śladów, 10 autorskich zjaw.

---

## Co działa teraz

### Strona główna (v0.7)

Uporządkowany ekran platformy: więcej ikon, mniej tekstu, żadnych
nachodzących na siebie bloków. Jasny motyw jest domyślny, ciemny nadpisuje
zmienne kolorów. Klimat horroru pojawia się wyłącznie w kafelku gry.

- górny pasek: wyszukiwarka (`/` focus), ikony dłoni / motywu / jakości,
  przycisk konta, awatar i **Lobby**; na wąskich ekranach etykiety znikają,
  więc pasek nigdy nie wypycha strony w bok,
- lewa nawigacja z 8 ikonami (Start, Światy, Assety, Postać, Edytor,
  Samouczek, Kamerka, Kopiuj logi), panel **„Na żywo”** i lista graczy —
  wyłącznie prawdziwe Presence,
- hero z podglądem awatara 3D i trzema chipami: konto wymagane / dłonie 1:1 /
  zero botów,
- pasek liczb: **120 assetów · 9 kategorii · 1 grywalny świat · 0 botów**,
- baner *Demonofobia*, „Ostatnio”, szeroki kafelek gry i kafelek parku Lobby,
- **Biblioteka assetów**: 9 kafli kategorii + modal z przeszukiwalną listą
  120 modeli, ich licencją i rozmiarem,
- panel postaci (nick, akcent, edytor) i cztery ikonowe kafle „Na start”,
- „Trzy kroki do gry” zamiast ściany tekstu.

Wybór motywu zapisuje się w `localStorage` (`rejplay:theme`). Skrypt motywu i
krytyczny CSS są w `<head>`, więc nie ma FOUC; ekran startowy zasłania scenę do
momentu załadowania modeli.

### Samouczek

Ośmiokrokowy modal (strona główna, lewy pasek, baner, start gry). Nawigacja:
`Dalej` / `Wstecz`, kropki, strzałki, `Esc`. Ilustracje to czysty CSS i tekst.

Kroki: ruch z przechwyconym kursorem (pełny obrót 360°) → sześć narzędzi na
pasie → skanowanie `E` → foto-dowód `P` (bez pliku) → nalot → notatnik `J` →
raport i wyjście.

### Edytor postaci

Zmiany widać natychmiast w podglądzie, lobby **i w dłoniach first-person**;
zapisują się w `localStorage` (`rejplay:appearance`). Przeciąganie obraca samą
postać — kamera i światła stoją nieruchomo.

| Grupa | Opcje |
| --- | --- |
| Sylwetka | **13 postaci Rocketbox: 9 męskich + 4 żeńskie** (Marek…Gustaw, Alicja, Ewa, Nina, Iza) |
| Odcień skóry | 6 ciepłych tonów; **domyślnie „Średnia”** dla wszystkich postaci i dłoni w grze |
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
(5 palców × 3 ogniwa), rozstawienie, roll, pitch, yaw oraz **pełną pozycję dłoni
w 3D**. `src/human.ts` odwzorowuje kąty na kości `Bip01_*_Finger*`, a pozycję
na `UpperArm` / `Forearm` awatara; `src/view-hands.ts` prowadzi dłonie
first-person. Poruszenie jednym palcem przed kamerą porusza tym samym palcem
awatara — z wygładzaniem, bez cooldownu, bez „wykrytego gestu”.

**Pozycja 3D (v0.5).** Kadr kamerki jest mapowany liniowo na przestrzeń przed
kamerą: `x` steruje poziomem w całym kadrze (dłoń w prawo → dłoń w prawo,
bez odwrócenia lustra), `y` wysokością, a `z` głębokością wyliczoną z rozmiaru
dłoni (odległość nadgarstek → nasada palca środkowego; MediaPipe `lm.z[0]` jest
względne i nie nadaje się do tego celu). Dłonie pierwszoosobowe wędrują po
całym ekranie, a `presence` wygładza powrót do spoczynku, gdy dłoń zniknie.
W pionie zakres jest celowo ograniczony do dolnej połowy kadru: przy pełnym 1:1
do góry wjeżdżałoby całe przedramię awatara i zasłaniało widok.

Wygładzanie pozycji jest **adaptacyjne**: szybki ruch skraca czas tłumienia
(brak „gumy”), a bezruch wydłuża go i wycina szum detekcji. Suwak
**„Odpowiedź pozycji 3D”** w panelu kamerki pozwala wybrać między
`Płynnie` a `Bardzo 1:1` (`rejplay:hand-responsiveness`). Panel pokazuje też
na żywo wartości `x / y / z` obu dłoni.

**Dłonie first-person to oryginalne dłonie awatara.** Nie ma już osobnego
proceduralnego viewmodelu z kapsułek. `AvatarViewHand` klonuje rigowany
`SkinnedMesh` wybranej postaci, wycina z niego trójkąty przypisane do kości
przedramienia / nadgarstka / palców, ustawia go przed kamerą i steruje tymi
samymi 15 stawami. Skóra, paznokcie, rękawy i proporcje palców są identyczne z
postacią w lobby i zmieniają się razem z edytorem. Jeśli GLB nie wczyta się
wcale, działa lekki `FallbackViewHand`.

MediaPipe: `maxNumHands: 2`, `modelComplexity: 1` (0 na słabym sprzęcie), pliki WASM/dane leżą lokalnie
w `public/mediapipe/` (zero CDN, zero danych opuszcza przeglądarkę). W grze panel
kamerki się chowa, ale **tracking działa dalej**. To **nie** jest wirtualny
aparat / tryb kamery (`C` usunięty); `P` zapisuje foto-dowód wyłącznie w
pamięci / notatniku — **bez PNG, bez pobierania, bez ukrytego downloadu**.

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
- `preserveDrawingBuffer: false` — żaden kadr nie jest zrzucany do pliku,
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

### Lobby first-person i dłonie przed oczami (v0.5)

Lobby ma teraz **widok z oczu** jako domyślny: kamera na wysokości 1,62 m,
własna sylwetka ukryta (dla innych graczy w Presence jest widoczna normalnie),
a przed oczami widać **te same rigowane dłonie awatara** co w grze — bez
narzędzia, z rozluźnionym chwytem. `src/first-person-hands.ts` trzyma osobną,
lekką scenę viewmodelu (własne światło, czysty Z-buffer), rysowaną przez ten
sam renderer po scenie lobby. Kamerka prowadzi tu dłonie w całym kadrze,
więc wrażenie jest bliskie VR, ale bez gogli.

`V` lub przycisk **„Widok: z oczu / 3D”** wraca do dawnej kamery za plecami
(gdzie widać całą postać i ruchy ramion). Wybór zapisuje się w
`rejplay:lobby-view`. Zdjęcie `P` w FP składa scenę lobby i viewmodel w jedno
PNG. Portal działa w obu widokach: przy wolnym kursorze klika się go myszą,
a przy przechwyconym — celownikiem z samego środka ekranu (podświetla się,
gdy trafia w portal).

### Mysz, dwa monitory i pełny obrót 360° (v0.5)

Bez przechwycenia kursora ruch myszy zatrzymywał się na krawędzi okna: na dwóch
monitorach kursor uciekał na drugi ekran, przeglądarka przestawała wysyłać
`movementX/Y` i nie dało się obrócić o pełny kąt. Teraz po starcie rundy gra
(prosząc o `unadjustedMovement`, z fallbackiem na zwykły lock) przejmuje kursor,
a delty są nieograniczone krawędzią ekranu — działa też w Lobby FP po jednym
kliku w widok 3D.

- pierwsze 1–2 zdarzenia `mousemove` po locku są ignorowane (skok
  „wyśrodkowania” kursora potrafił obrócić kamerę o pół obrotu),
- `Esc` tylko zwalnia kursor, dzięki czemu HUD, narzędzia i karty zjaw w
  notatniku są klikalne; ponowne `Esc` wychodzi z gry,
- `J` / `Tab` otwierając notatnik zwalnia kursor, zamykając — przejmuje go
  z powrotem; ekran wyniku i wyjście zawsze zwalniają blokadę,
- suwak w intro oraz `[` / `]` zmieniają czułość myszy w każdej chwili
  (`rejplay:look-sensitivity`, 0,6×–2×),
- gdy przeglądarka odmówi locka (np. osadzona ramka bez `allow="pointer-lock"`),
  podpowiedź tłumaczy fallback: przytrzymanie lewego przycisku i trzymanie
  kursora przy krawędzi okna daje **ciągły** obrót oparty o zegar ścienny,
  więc nawet przy 2 FPS nie zwalnia razem z animacją.

### Lobby i multiplayer

**Lobby to park, nie betonowy plac.** Jasne niebo z gradientem, słońce z cieniami,
trawnik, okrągła alejka z czterema dojściami, altana z zegarem słonecznym,
osiem klombów, oczko wodne, drewniana tablica „Lobby” i brama z okładką gry.
Gotowe GLB dokładają drzewa, żywopłoty, ławki, latarnie, stojak na rowery,
drogowskaz i fontannę. W altanie stoi **galeria trzech nowych assetów**
(aparat, boombox, sofa) na postumentach — podgląd biblioteki w silniku gry.
Żadnych postaci udających graczy: ludzkie modele są w katalogu, nie w parku.
`Demonofobia · graj` uruchamia dochodzenie. Lobby nie jest osobną grą.

- **prawdziwi gracze**: pozycja, obrót, nick, kolor i wygląd awatara przez
  Supabase **Realtime Presence**; obcy awatary są rigowanymi postaciami 3D,
  wygładzanymi interpolacją,
- **wspólny czat** zapisywany w `rejplay_chat` i dostarczany przez
  `postgres_changes` (historia 12 ostatnich wiadomości),
- **zero botów demonstracyjnych** — lista graczy to wyłącznie Presence; bez
  połączenia z serwerem nie pokazujemy nawet siebie jako „online” i ponawiamy
  łączenie (nie ma trybu offline),
- **drużyny (party)**: utwórz kod, wyślij link, czat i Presence zawężają się
  do `rejplay:party:<kod>`, a „Rozpocznij razem” wysyła broadcast do całej ekipy,
- `WASD` / strzałki, `Spacja`, przeciąganie myszą lub pointer lock, dotyk,
- `V` — pierwszoosobowy widok z oczu ↔ kamera trzecioosobowa,
- `E` / **Machaj** — emote bez VR, wysyłany jako broadcast `wave` na kanał
  Lobby/drużyny (limit 1,2 s); u odbiorców animuje awatara nadawcy i pokazuje
  powiadomienie. Odrzucamy zdarzenia własne, puste, nieprawidłowe i starsze
  niż 15 s. Kamerka steruje palcami **i pozycją 3D**.

### Supabase `rejson-widgets`

Projekt `hzbqzfimtroixnldzjeq` (eu-central-1). W frontendzie używamy
**wyłącznie klucza publishable/anon** — `service_role` i sekrety nigdy nie
trafiają do kodu ani do bundla. Konfigurację można nadpisać zmiennymi
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (patrz `.env.example`).

| Tabela | Zawartość |
| --- | --- |
| `rejplay_profiles` | nick, kolor, wygląd JSON, `client_id` z localStorage |
| `rejplay_chat` | wiadomości Lobby (max 180 znaków) |
| `rejplay_events` | `game_open`, `game_start`, `game_win`, `game_fail`, `photo`, `lobby_enter` |
| `rejplay_parties` | kod, nazwa, lider (UUID konta głównej strony), wygaśnięcie |
| `rejplay_party_members` | `client_id`, `user_id`, nick, kolor, wygląd, `last_seen_at` |

**Konta i brama logowania (v0.7):** RejPlay nie ma własnej bazy haseł, ale ma
własny, ładny ekran **logowania i rejestracji** (`#auth`, `src/auth-gate.ts`).
Używa tych samych RPC co `/logowanie` na głównej stronie:
`community_login(p_username, p_pin)` / `community_register(...)` /
`community_whoami(p_token)` i tego samego klucza
`rejson_community_session_v1` w `localStorage`. Dzięki temu jedno konto działa
na całym `rejson59.github.io`, a formularz działa także w dev na localhost.
Bez zalogowania lub rejestracji **nie można zagrać** — `enterLobby()` i
`openGame()` wołają `AuthGate.require()`, więc żaden przycisk, skrót ani portal
3D nie obejdzie blokady. Po udanym logowaniu brama wznawia klikniętą akcję.
RPC `community_*` używają dokładnie tego publicznego klucza `anon` co
`/js/logowanie.js` (`COMMUNITY_ANON_KEY`); Presence, czat i zdarzenia używają
klucza publishable z `src/online.ts`. W `<head>` wciąż ładujemy
`/js/rejson-account.js?v=1` tylko na wspólnym originie — wtedy sesję
potwierdza gotowy bridge zamiast bezpośredniego RPC. Każda funkcja drużyny dodatkowo waliduje token po stronie serwera
przez `community_session_user(p_token)`. Token nigdy nie trafia do URL, czatu,
Presence, logów ani `postMessage`. Tabele drużyn mają włączone RLS i **brak
polityk dla anon** — dostęp wyłącznie przez funkcje `SECURITY DEFINER`.

Migracje (RLS, indeksy, publikacja `supabase_realtime`, funkcje RPC) leżą w
`supabase/migrations/20261102190000_rejplay_multiplayer.sql`,
`20261104190000_rejplay_parties.sql` oraz
`20261104191000_rejplay_party_auth_fix.sql` i zostały zastosowane w projekcie. **Jeśli baza jest niedostępna**, wskaźnik pokazuje
„Ponawiam połączenie”, a gra nie udaje lokalnego multiplayera: czat nie
przyjmuje wiadomości bez serwera (zamiast „tylko u Ciebie" dostaje komunikat
systemowy), Presence nie pokazuje fikcyjnych graczy, a podgląd postaci
i katalog assetów wciąż działają. Rozpoczęcie gry wymaga potwierdzonego konta
(`community_whoami`), więc przy niedostępnej bazie nie można zweryfikować
sesji — zgodnie z założeniem „bez konta nie gramy". Istniejąca, ważna sesja
jest odczytywana ponownie po powrocie połączenia.

### Demonofobia — jedyna grywalna gra

**Oryginalna, autorska gra dochodzeniowa.** Nie używamy nazwy *Phasmophobia*,
jej duchów, lore'u, interfejsu, dźwięków ani assetów Kinetic Games. Wszystkie
nazwy, opisy zjaw, dowody, dźwięki (WebAudio) i geometria domu są napisane od
zera. Podobieństwo dotyczy **mechaniki gatunku**: first-person, ręczne zbieranie
dowodów, dedukcja typu zjawy, notatnik, narastające zagrożenie, ucieczka.

Pierwszoosobowe dochodzenie przy Wrzosowej 12: cztery pokoje, korytarz,
podwórko z **samochodem-bazą** (start, monitoring, bezpieczna strefa, regeneracja
nerwów, przerwanie nalotu), latarka, **sześć narzędzi**, **sześć śladów**,
**dziesięć zjaw** i 16 miejsc z poszlakami.

**Wygląd i realizm:**

- proceduralne tekstury z canvas (deski ze słojami, tapeta z zaciekami,
  tkanina, glazura, dywan) z mapami wypukłości,
- meble z zaokrąglonych krawędzi i toczenia: stół, krzesła, regał z książkami,
  fotel, łóżko, szafki, zlew, czajnik, wieszak, lustro, zegar, obrazy, kurz,
- **25 gotowych, fotorealistycznych assetów CC0 / MIT** w `public/assets/props/`:
  oryginalne 8 rekwizytów Poly Haven plus 17 modeli z GridFall (drzewa, ławki,
  latarnie, fontanna, donice, hydrant, bariera, kontener, klimatyzator,
  `van_white.glb` jako baza). Tekstury 1K są osadzone w GLB — bez CDN, bez
  połączenia. Noty: `LICENSE-polyhaven-cc0.txt`, `LICENSE-gridfall-MIT.txt`,

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
| Pas na biodrach | 6 slotów 3D przypiętych do kamery + te same sloty w HUD; weź `1`–`6`, odłóż `Q`, wskaż palcem lub spojrzeniem |
| Narzędzia | `1` Termometr · `2` Miernik pola · `3` Rejestrator · `4` Latarka UV · `5` Czujnik ruchu · `6` Kamera nocna |
| Gesty | zaciśnięcie palców = chwyć / użyj, dłoń otwarta ~0,9 s = odłóż, palec wskazujący = wybierz slot |
| Skan | przytrzymaj `E` (albo zaciśnij palce) przez ~1,2 s — `wykryto` albo `brak śladu` |
| Dowody | Zimny punkt, Zakłócenia pola, Szepty, Odciski dłoni, Kroki bez źródła, Cienie w kadrze |
| Zjawy | Mara, Iskra, Szron, Cisza, Popiół, Nić, Odcień, Kurz, Kompas, Głębia |
| Foto-dowód | `P` zaznacza dowód w notatniku; **nie zapisuje PNG ani nie pobiera pliku** |
| Nalot | co ~30–48 s; wyjście frontowymi drzwiami, `P` lub przeczekanie kończy go |
| Nerwy | maleją z czasem, szybciej po ciemku, podczas zjawisk i nalotu |
| Raport | `J` / `Tab` → wybierz zjawę; pomyłka kosztuje 24 nerwy |

Sterowanie: `WASD` + mysz z **pointer lockiem** (nieograniczone `movementX/Y`,
pełny obrót 360°), `Shift` bieg, `F` latarka, `Esc` najpierw zwalnia kursor,
ponowne `Esc` / `← Wyjdź` wychodzi z gry. Na dotyku: joystick + `Skanuj`, `Bieg`,
`Foto`, `Narzędzie`, `Notatnik`, `Latarka` (przyciski trzymane palcem mają
wizualny stan wciśnięcia).

### Laboratorium kamery — konfiguracja wstępna

Dostęp z lewego paska, ekranu startowego gry i przycisku w górnym pasku.
Jeden element `<video>` jest współdzielony przez Hands i FaceMesh — nie ma
drugiej zgody na kamerę. Obraz nie opuszcza przeglądarki.

1. **Kalibracja** — patrz prosto przez ~2 s: zapisujemy neutralny yaw/pitch/roll
   oraz neutralne spojrzenie (każda twarz ma inną geometrię).
2. **Test dłoni** — obie dłonie z prostymi palcami, potem zaciśnięcie i otwarcie.
3. **Test głowy** — kiwnięcie przód/tył i przechył na bok (mierzony zakres sygnału).
4. **Test oczu** — spojrzenie lewo/prawo/góra/dół bez ruchu głowy (10 punktów
   tęczówki na oko dzięki `refineLandmarks`), alternatywnie mrugnięcie.

Pod podglądem jest **status wykrywania**: gotowość obu modeli, liczba wysłanych
klatek, liczba faktycznie zobaczonych twarzy i klatek ze źrenicami, rozmiar
kadru i wybrane ograniczenie `getUserMedia`. Przyciski **„Restart kamerki”**,
**„Kopiuj logi”** i **„Pokaż logi”** są też w panelu kamerki, więc raport
można pobrać bez wchodzenia do laboratorium.

FaceMesh nie jest już ładowany do głównego dokumentu: rodzic przesyła do
izolowanego iframe tylko pomniejszone klatki (`ImageBitmap`, transfer bez
kopii; fallback na surowe piksele). Dzięki temu `hands.send()` nie trafia na
uszkodzony WASM. Progi `minDetectionConfidence` / `minTrackingConfidence`
zbito z 0,55/0,6 do 0,3/0,35–0,45, a kadr dla twarzy to 320×240 na słabszym
sprzęcie.

Suwaki: czułość oczu, czułość przechyłu, martwa strefa, wygładzanie, odwrócenie
poziomu. Gdy cztery warunki są zielone, przycisk **„Włącz grę bez klawiatury”**
odblokowuje sterowanie: `lookX/lookY` wchodzą do tej samej ścieżki co ruch
myszą (`world.applyCameraControl` → `horror.look` / `yaw`), a `moveX/moveY`
sumują się z `WASD` i joystickiem. Ustawienia i kalibracja zapisują się w
`localStorage` (`rejplay:camera-control-v1`).

---

## Sterowanie — skrót

| Klawisz | Akcja |
| --- | --- |
| `/` | focus na wyszukiwarce |
| `W A S D`, strzałki | ruch w lobby i w grze |
| `Spacja` | skok w lobby |
| `E` | machnięcie (lobby) / skanowanie, przytrzymaj (gra) |
| `1`–`6` | weź narzędzie z pasa (gra) |
| `Q` | odłóż narzędzie na pas (gra) |
| `P` | foto-dowód tylko w pamięci / UI — bez PNG i bez pobierania (gra) |
| `F` | latarka (gra) |
| `J` / `Tab` | notatnik (gra) |
| `Shift` | bieg (gra) |
| `V` | Lobby: widok z oczu ↔ kamera za plecami (`rejplay:lobby-view`) |
| klik w widok 3D | przejęcie kursora; przy locku w Lobby = użyj portalu pod celownikiem |
| `[` `]` | czułość myszy w trakcie rundy (`rejplay:look-sensitivity`) |
| `Esc` | w grze / FP: najpierw zwalnia kursor, ponowne `Esc` wychodzi; poza grą zamyka kamerki / samouczek / edytor |

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
`https://rejson59.github.io/RejPlay/`. Workflow uruchamia `typecheck`, testy
i build na każdym pull requeście, a artefakt Pages i deploy powstają wyłącznie
z `main`. Strona jest SPA bez routingu po stronie serwera, więc nie potrzebuje
`404.html`.

---

## Struktura

```
index.html                     strona główna, lobby, gra, edytor, samouczek, boot overlay
src/style.css                  jasny/ciemny katalog + widoki pełnoekranowe
src/main.ts                    stan UI, motyw, samouczek, HUD, kamerka, online, boot
src/games.ts                   jedna gra + Lobby, 13 modeli, 8 strojów (męskie/damskie)
src/world.ts                   jeden renderer, 3 sceny + viewmodel, portale GLB, awatary
src/performance.ts             adaptacyjna jakość: profile, EMA klatek, DPR, cienie, limit fps
src/character.ts               slot gracza: rigowana postać + zastępnik
src/human.ts                   13 GLB, maski głowy/ubrania, retarget dłoni, kolory skóry
src/hand-tracking.ts           MediaPipe Hands: 21 punktów obu dłoni (lub strumień z rigu)
src/face-tracking.ts           MediaPipe FaceMesh: 478 punktów, źrenice, głowa, mruganie
src/camera-rig.ts              jeden strumień → Hands + FaceMesh + sterowanie + gesty
src/camera-control.ts          kalibracja, 3 testy, mapowanie głowa/oczy/palce
src/tracking-guard.ts          czyste zabezpieczenia numeryczne, etykiety dłoni, FrameWatchdog
src/face-math.ts               głowa / oczy / mrugnięcie bez DOM (testowalne w Node)
src/hand-pose.ts               21 punktów → 15 kątów, anatomia, tenodesis, kaskada palców
src/view-hands.ts              dłonie FP: rig awatara + anatomiczny fallback + narzędzie LCD
src/first-person-hands.ts      wspólny viewmodel dłoni first-person dla Lobby
src/movement.ts                czysta kolizja i bezpieczny punkt startu Demonofobii
src/horror.ts                  Demonofobia: silnik, ruch, nalot, dźwięk, first-person
src/horror-decor.ts            proceduralne tekstury, meble, światła i kurz
src/real-props.ts              17 gotowych rekwizytów CC0 / MIT w grze
src/real-scenery.ts            42 obiekty parku z GLB + 10 podwórka + galeria + baza
src/park.ts                    wyłącznie teren, niebo i światła Lobby (zero brył)
src/tool-belt.ts               pas na biodrach: 6 slotów 3D w viewmodelu
src/diagnostics.ts             bezpieczny bufor logów + raport do schowka
src/community-account.ts       wspólne konto + bezpieczne refresh() (bez martwego pending)
src/auth-gate.ts               ekran logowania/rejestracji + twarda blokada gry
src/dialog.ts                  focus trap i przywracanie fokusu dla obu okien modalnych
src/asset-catalog.ts           120 modeli w 9 kategoriach (jedno źródło dla UI)
src/online.ts                  Presence / czat / profile / broadcast wave i party_start
src/avatar.ts                  wspólny interfejs awatara i etykiety
tests/                         50 testów `node --test` + hak resolucji `.ts`
supabase/migrations/           multiplayer + drużyny + autoryzacja zapisu (RLS, RPC z tokenem)
.github/workflows/             typecheck + testy + build na każdym PR, deploy wyłącznie z main
public/mediapipe/face/         lokalny runtime FaceMesh (Apache-2.0) + bridge.html
public/mediapipe/              lokalne pliki MediaPipe Hands
public/characters/             13 GLB + animacje + gotowe tekstury + licencja MIT
public/assets/props/           25 GLB parkowych (MIT + CC0)
public/assets/library/         95 GLB w 8 kategoriach (MIT / CC0 / CC-BY)
public/assets/ASSETS.json      maszynowy katalog 120 modeli + licencje
public/assets/LICENSE-*.txt    GridFall MIT, Poly Haven CC0, Khronos CC0/CC-BY
public/art/                    house.jpg — jedyna okładka
```

---

## Assety i licencje

- **Postacie i ubrania**: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
  — MIT, `Copyright (c) 2020 Microsoft`. GLB i tekstury z konwersji w
  `KunalSiyag/gridfall` (MIT, `PROVENANCE.json` → commit Rocketbox `0943055…`).
  Licencja: `public/characters/LICENSE-rocketbox-MIT.txt`.
- **Realistyczne rekwizyty (25)**: [Poly Haven](https://polyhaven.com) —
  **CC0 1.0**, pobrane z `models/real/props` w GridFall; geometria
  `KunalSiyag/gridfall` — **MIT**. Noty: `LICENSE-polyhaven-cc0.txt`,
  `LICENSE-gridfall-MIT.txt`.
- **Biblioteka wielogrowa (76 nowych GLB)**: meble, przedmioty, postacie,
  zwierzęta, pojazdy, budynki, roślinność i ulica. Część z GridFall
  (MIT/CC0), część z [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
  (**CC0** lub **CC BY 4.0** z podanym autorstwem w
  `LICENSE-khronos-cc0-ccby.txt`). Tekstury zmniejszono do 512 px, bufory
  skompresowano `EXT_meshopt_compression` (dekoder z `three/addons`); zmiany
  są opisane w nocie licencyjnej zgodnie z wymogiem CC BY 4.0.
  Łącznie **120 darmowych modeli**; `public/assets/ASSETS.json` zawiera nazwę,
  kategorię, ścieżkę, źródło, licencję i rozmiar każdego z nich. Assety NIE są
  związane tylko z horrorem — Demonofobia jest pierwszą z wielu planowanych gier.
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
| 21 punktów → 15 stawów + pozycja dłoni x/y/z + ramiona, 2 dłonie naraz | Śledzenia łokcia z osobnego sensora (kąt wyliczamy z pozycji) |
| 120 darmowych modeli PBR (CC0 / CC BY / MIT), jeden renderer | Metahuman / silnika typu Unreal w przeglądarce |
| Auto jakość (DPR, cienie, kurz, fps) i układ dotykowy na telefon/tablet | Profilowania na realnym GPU, fizycznych urządzeniach i wielu realnych klientach Supabase |
| Prawdziwych graczy, czat i profile w Supabase | Serwerowego autorytatywnego world state / anty-cheat |

---

## Weryfikacja v0.8

Trzy fazy zrealizowane w kolejności: (1) realnie działający ruch w
Demonofobii, (2) anatomia i model dłoni, (3) park wyłącznie z gotowych GLB
oraz rozbudowa katalogu. Wszystkie poniższe przebiegi wykonano na tym samym
kodzie, który trafia do `dist/`.

| Zakres | Wynik |
| --- | --- |
| Błąd chodzenia | zreprodukowany w headless przed poprawką: `keys = ['KeyW']`, `velocity.z = -0.26`, a `position = (0, 12.4)` pozostawało bez zmiany. Po poprawce `yaw = yawTarget = 0`, start `(0, 11.6)`, 120 klatek `W` → `(0.23, 6.75)`, czyli przejście przez frontowe drzwi do wnętrza domu |
| Focus | sztucznie ustawiony focus w `<input>` przed startem rundy → po `startGameRound()` aktywny jest `SECTION#game`; WASD dociera do silnika |
| `npm run typecheck` | 0 błędów |
| `npm test` | **50 / 50** — 11 testów kolizji/startu, 5 integralności katalogu, 6 realizmu dłoni + 29 z v0.7.1 |
| `npm run build` | `index.html` 51,76 kB · CSS 91,69 kB · JS 1128,98 kB (gzip 301,34 kB) |
| Dłonie | 6 testów: minima stawów bez wywijania, `applyTenodesis()` w obie strony, limity i `NaN`, kaskada MCP > PIP > DIP oraz palec wskazujący > mały, domknięcie do celu < 0,01 po 120 klatkach |
| Kamerka (fake device) | laboratorium startuje, watchdog zeruje sterowanie przy braku odczytu, „Restart kamerki" bez wyjątków; raport `v0.8.0`, pola trackingowe, 0 sekretów, 0 `NaN`, `pageErrors: []` |
| CI | workflow reaguje na `pull_request`; job `verify` = `npm ci` → `typecheck` → `test` → `build`; test integralności katalogu sprawdza nagłówki glTF 2.0 i licencje |
| Park | `park.ts` ma wyłącznie płaskie, teksturowane powierzchnie terenu (`Sphere/Cylinder/Circle/Ring/Plane`); 0 `Box/Cone/Torus/Capsule`. Wszystkie widoczne obiekty i portale to GLB |
| Lobby w przeglądarce | 26 unikalnych plików GLB, każdy pobrany dokładnie raz (współdzielony cache + klony) → same `200`, 0 błędów konsoli, 0 lokalnych 4xx, `liveCount: 0`, „Brak połączenia — nikt nie jest widoczny"; znak „Lobby" i okładka gry czytelne (naprawiony `flipY` dla UV glTF) |
| Produkcja (`vite preview`) | 7 szerokości 320–1920 px: `scrollWidth = viewport`, 0 wystających elementów; katalog 120 modeli / 9 kategorii / 120 wierszy modalu; raport „Kopiuj logi" ma `v0.8.0`, 0 sekretów, 0 `NaN`; `pageErrors: []`, lokalne 4xx: `[]` |
| Assety | 120 plików GLB zwalidowanych jako glTF 2.0 w teście CI; rozmiar każdego zgodny z `ASSETS.json`; suma < 80 MB; CC BY 4.0 zawsze ma autorstwo; 3 noty licencyjne zaktualizowane |

**Nadal niezweryfikowane:** fizyczna kamerka i dotyk na urządzeniu, dwóch
realnych klientów przez WSS Presence, profilowanie GPU. Testy headless nie
zastąpią prawdziwego sensora — to jawnie wpisane w roadmapę poniżej.

---

## Weryfikacja v0.7.1

| Zakres | Wynik |
| --- | --- |
| `npm run typecheck` | 0 błędów (`noUnusedLocals` / `noUnusedParameters` nadal włączone) |
| `npm test` | **29 / 29** — czysta matematyka twarzy, zabezpieczenia numeryczne, sprężyna dłoni, dryf kamery po utracie twarzy, kalibracja nadgarstka, uszkodzone ustawienia z `localStorage` |
| `npm run build` | `index.html` 51,76 kB · CSS 91,69 kB · JS 1125,99 kB (gzip 300,42 kB) |
| CI | workflow reaguje na `pull_request`; job `verify` = `npm ci` → `typecheck` → `test` → `build`; artefakt Pages i deploy tylko z `main` |
| Baza (realna) | migracja `rejplay_write_auth` zastosowana w `rejson-widgets`: 3 polityki `SELECT`, 0 polityk zapisu, 3 funkcje `SECURITY DEFINER`; test `SET ROLE anon; INSERT` → `new row violates row-level security policy`; RPC z błędnym tokenem zwraca `ok:false` |
| Produkcja (`vite preview`) | 7 szerokości 320–1920 px: `scrollWidth = viewport`, 0 wystających elementów; katalog 101 modeli; raport „Kopiuj logi" ma `v0.7.1`, pola trackingowe, 0 sekretów, 0 `NaN`; `pageErrors: []`, lokalne 4xx: `[]` |
| Brama konta | bez sesji zablokowane wejście do Lobby i gry; po logowaniu akcja wznawiana, `Lobby · RejPlay`, `liveCount: 0`, „Brak połączenia — nikt nie jest widoczny" |
| Kamerka (fake device) | laboratorium startuje, watchdog twarzy poprawnie zeruje sterowanie przy braku odczytu, „Restart kamerki" bez wyjątków; `pageErrors: []` przed i po restarcie |

**Nadal niezweryfikowane:** realna, fizyczna kamerka i dotyk na urządzeniu,
dwa niezależne klienty Supabase połączone przez WSS Presence, profilowanie na
GPU. To właśnie te punkty domyka następna faza — testy jednostkowe i headless
nie zastąpią prawdziwego sensora.

---

## Weryfikacja v0.7

Wszystkie poniższe przebiegi wykonano na branchu roboczym przed wdrożeniem,
w przeglądarce headless z tym samym kodem, który trafia do `dist/`.

| Zakres | Wynik |
| --- | --- |
| `npm run typecheck` | 0 błędów; w `tsconfig.json` włączone `noUnusedLocals` i `noUnusedParameters`, więc martwy kod nie może wrócić |
| `npm run build` | `index.html` 51,76 kB · CSS 91,69 kB · JS 1117,97 kB (gzip 297,85 kB) |
| Układ 320 / 375 / 390 / 768 / 1024 / 1440 / 1920 px | `overflow: false`, brak wystających elementów, **0 par nakładających się sekcji** na każdej szerokości |
| Assety | 101 plików GLB zwalidowanych jako glTF 2.0, 0 brakujących ścieżek, `ASSETS.json` = `asset-catalog.ts`, 3 noty licencyjne |
| Brama konta | bez sesji zablokowane wejście do gry **i** Lobby (przyciski, kafelki, skróty, portale 3D); po logowaniu akcja wznawiana jest automatycznie |
| Błędy brzegowe | awaria RPC (503) → czytelny komunikat i odblokowany formularz; wygasły token → usunięty z `localStorage`; anulowanie bramy czyści oczekującą akcję; wylogowanie ponownie blokuje grę |
| Okna modalne | brama zawsze nad katalogiem, focus trap + przywrócenie fokusu, `Esc`, filtr kategorii z możliwością wyczyszczenia, puste stany z kontekstowym komunikatem, escapowanie frazy wyszukiwania (XSS) |
| Regresja v0.6.1 | motyw ciemny (home + oba modale), start gry z 6 narzędziami, `P` bez pobierania pliku, brak automatycznego pointer locka, 0 błędów konsoli i 0 odpowiedzi 4xx |
| Build produkcyjny | `vite preview` pod `/RejPlay/`: 30 ładowań GLB → same `200`, katalog 101 modeli, „Lobby” bez starych nazw, brak sekretów w DOM |
| Lobby | park w świetle dnia, 1 gracz (Ty), 0 botów, bez trybu offline: czat i Presence czekają na serwer, a lampy nie przekraczają 7 m wysokości |

**Niezweryfikowane w sandboxie (egres ograniczony do GitHub / npm / PyPI):**
połączenie z realnym Supabase z dwoma niezależnymi klientami, WSS Presence
(v0.7.1 zastosowało i sprawdziło natomiast samą migrację RLS bezpośrednio
na bazie),
fizyczna kamerka i dotyk na prawdziwym urządzeniu, profilowanie na GPU.
RPC konta (`community_login` / `community_register` / `community_whoami`)
zostały sprawdzone z mockami odpowiadającymi dokładnie kształtowi
`/js/logowanie.js`; w produkcji formularz używa tego samego publicznego
klucza `anon` i — na współdzielonym originie — gotowego bridge’a
`window.RejsonAccount`.

---

## Roadmapa (kolejność prac)

1. **v0.8 ✅:** błąd chodzenia, park wyłącznie z gotowych GLB, 120 assetów,
   realizm ruchu i geometrii dłoni.
2. **v0.9 ✅ (ten release):** pewny STOP i stan neutralny, kalibracja
   oczu/głowy/dłoni 9 punktami, drożny spawn i collidery w Demonofobii,
   usunięcie trybu offline, normalizacja skali lamp, 82 testy.
3. **v0.10 — wydajność:** `import()` dla `World` / `HorrorGame` / trackerów,
   lazy GLB z anulowaniem, LOD, budżet rozmiaru bundla w CI. Obecnie cały
   `src` ładuje się statycznie, więc home ściąga też silnik horroru.
4. **v1.0 — Lobby żyje:** podgląd 3D każdego z 120 assetów (turntable w
   katalogu + „wstaw do sceny"), profil, znajomi i postęp w bazie, limit
   graczy w pokoju i realny „start razem".
5. **v1.1 — wielogrowość:** druga gra jako osobna scena i wpis w `GAMES`,
   piaskownica UGC z bezpiecznym skryptowaniem, fizyka (Rapier), i18n PL/EN.
6. **Później:** autorytatywny stan świata, osiągnięcia, monitoring błędów,
   monitoring błędów, realna kamerka / dotyk / dwóch klientów WSS na fizycznych
   urządzeniach.

Kolejność jest celowa: najpierw siatka bezpieczeństwa i zgłoszone przez gracza
usterki, potem zmiana architektury ładowania, dopiero potem nowe funkcje
i kolejne gry.

Wspomniany luźno „CS” nie został dodany: jest jedna grywalna gra, a zakres
ewentualnego nowego tytułu wymaga doprecyzowania. Platforma, katalog assetów i
Lobby są jednak od v0.7 wielogrowe — kolejne gry powstaną jako osobne sceny
i osobne wpisy w `GAMES`, bez przerabiania strony głównej od zera.

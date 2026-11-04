# RejPlay

Przeglądarkowa platforma 3D: **jedna autorska gra** (*Demonofobia*) i jedno
wspólne lobby (*Atrium*). Frontend jest w pełni statyczny (Vite + Three.js,
jeden kontekst WebGL) i działa na **GitHub Pages**. Multiplayer, czat i profile
korzystają z istniejącego projektu **Supabase `rejson-widgets`** — nie mamy
własnego serwera, ale gra bez połączenia z bazą nadal działa lokalnie.

Nie ma katalogu wielu światów, zapowiedzi gier, karuzeli ani zmyślonych metryk.
W `public/art/` jest jeden plik: `house.jpg` (kafelek gry i baner).

**v0.5:** pełna pozycja dłoni w 3D (x / y / głębokość) zamiast tylko palców
i drobnych ruchów nadgarstka, first-person w Atrium, przechwycenie kursora
z pełnym obrotem 360° dla wielu monitorów, adaptacyjne wygładzanie i czułość
ruchu do ustawienia na żywo.

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

### Atrium first-person i dłonie przed oczami (v0.5)

Atrium ma teraz **widok z oczu** jako domyślny: kamera na wysokości 1,62 m,
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
a delty są nieograniczone krawędzią ekranu — działa też w Atrium FP po jednym
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

### Lobby `Atrium` i multiplayer

Spokojna, filmowa scena: beton, ciepłe latarnie, księżyc, obelisk, brama.
`Demonofobia · graj` uruchamia dochodzenie. Lobby nie jest osobną grą w katalogu.

- **prawdziwi gracze**: pozycja, obrót, nick, kolor i wygląd awatara przez
  Supabase **Realtime Presence**; obcy awatary są rigowanymi postaciami 3D,
  wygładzanymi interpolacją,
- **wspólny czat** zapisywany w `rejplay_chat` i dostarczany przez
  `postgres_changes` (historia 12 ostatnich wiadomości),
- **zero botów demonstracyjnych** — lista graczy to wyłącznie Presence,
- **drużyny (party)**: utwórz kod, wyślij link, czat i Presence zawężają się
  do `rejplay:party:<kod>`, a „Rozpocznij razem” wysyła broadcast do całej ekipy,
- `WASD` / strzałki, `Spacja`, przeciąganie myszą lub pointer lock, dotyk,
- `V` — pierwszoosobowy widok z oczu ↔ kamera trzecioosobowa,
- `E` / **Machaj** — emote bez VR; kamerka steruje palcami **i pozycją 3D**.

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
| `rejplay_parties` | kod, nazwa, lider (UUID konta głównej strony), wygaśnięcie |
| `rejplay_party_members` | `client_id`, `user_id`, nick, kolor, wygląd, `last_seen_at` |

**Konta:** RejPlay nie ma własnej rejestracji ani haseł. W `<head>` ładuje
`/js/rejson-account.js?v=1` TYLKO na `rejson59.github.io` (wspólny origin =
wspólny `localStorage`). Sesja `rejson_community_session_v1` jest potwierdzana
przez `community_whoami`, a każda funkcja drużyny dodatkowo waliduje
`session.token` po stronie serwera przez `community_session_user(p_token)`.
Token nigdy nie trafia do URL, czatu, Presence ani `postMessage`. Tabele
drużyn mają włączone RLS i **brak polityk dla anon** — dostęp wyłącznie przez
funkcje `SECURITY DEFINER`.

Migracje (RLS, indeksy, publikacja `supabase_realtime`, funkcje RPC) leżą w
`supabase/migrations/20261102190000_rejplay_multiplayer.sql`,
`20261104190000_rejplay_parties.sql` oraz
`20261104191000_rejplay_party_auth_fix.sql` i zostały zastosowane w projekcie. **Jeśli baza jest niedostępna**, wskaźnik na
stronie przechodzi w „Tryb offline”, czat zostaje w karcie, a gra, lobby i
kamerka działają normalnie — brak połączenia nie blokuje rozgrywki.

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
| `1` `2` `3` | wybór narzędzia (gra) |
| `P` | foto-dowód → zapis PNG (gra) |
| `F` | latarka (gra) |
| `J` / `Tab` | notatnik (gra) |
| `Shift` | bieg (gra) |
| `V` | Atrium: widok z oczu ↔ kamera za plecami (`rejplay:lobby-view`) |
| klik w widok 3D | przejęcie kursora; przy locku w Atrium = użyj portalu pod celownikiem |
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
`https://rejson59.github.io/RejPlay/`. Na branchach roboczych workflow robi
tylko build (repozytorium pozwala deployować wyłącznie z `main`). Strona jest
SPA bez routingu po stronie serwera, więc nie potrzebuje `404.html`.

---

## Struktura

```
index.html                     strona główna, lobby, gra, edytor, samouczek, boot overlay
src/style.css                  jasny/ciemny katalog + widoki pełnoekranowe
src/main.ts                    stan UI, motyw, samouczek, HUD, kamerka, online, boot
src/games.ts                   jedna gra + lobby, 13 modeli, 8 strojów (męskie/damskie)
src/world.ts                   jeden renderer, 3 sceny + viewmodel, awatary zdalnych graczy
src/performance.ts             adaptacyjna jakość: profile, EMA klatek, DPR, cienie, limit fps
src/character.ts               slot gracza: rigowana postać + zastępnik
src/human.ts                   13 GLB, maski głowy/ubrania, retarget dłoni, kolory skóry
src/hand-tracking.ts           MediaPipe Hands: 21 punktów obu dłoni (lub strumień z rigu)
src/face-tracking.ts           MediaPipe FaceMesh: 478 punktów, źrenice, głowa, mruganie
src/camera-rig.ts              jeden strumień → Hands + FaceMesh + sterowanie + gesty
src/camera-control.ts          kalibracja, 3 testy, mapowanie głowa/oczy/palce
src/community-account.ts       wspólne konto rejson59.github.io (bez własnej bazy użytkowników)
src/tool-belt.ts               pas na biodrach: 6 slotów 3D w viewmodelu
src/real-scenery.ts            13 rekwizytów lobby + 10 podwórka + samochód-baza
src/hand-pose.ts               21 punktów → 15 kątów, rozstaw, obroty, pozycja dłoni 3D
src/view-hands.ts              prawdziwe dłonie awatara (SkinnedMesh) + narzędzie LCD
src/first-person-hands.ts      wspólny viewmodel dłoni first-person dla Atrium
src/online.ts                  Supabase Realtime Presence / czat / profile / zdarzenia
src/real-props.ts              17 gotowych rekwizytów CC0 / MIT w grze
src/horror-decor.ts            proceduralne tekstury, meble, światła i kurz
src/horror.ts                  Demonofobia: silnik, ruch, nalot, dźwięk, first-person
src/avatar.ts                  wspólny interfejs awatara i etykiety
supabase/migrations/           multiplayer + drużyny (RLS, RPC z walidacją tokenu)
public/mediapipe/face/         lokalny runtime FaceMesh (Apache-2.0)
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
| 21 punktów → 15 stawów + pozycja dłoni x/y/z + ramiona, 2 dłonie naraz | Śledzenia łokcia z osobnego sensora (kąt wyliczamy z pozycji) |
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

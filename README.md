# RejPlay

Przeglądarkowy prototyp platformy do grania w małe gry 3D. Wchodzisz na stronę,
przeglądasz katalog światów, tworzysz własną postać, spotykasz się w lobby i
uruchamiasz pierwszą pełną grę: **Zimny Ślad**.

Bez instalacji, bez konta i bez backendu — całość to statyczna aplikacja Vite +
Three.js z jednym współdzielonym kontekstem WebGL.

---

## Co działa teraz

### Strona główna (katalog w stylu platformy)

Jasny, neutralny ekran odkrywania gier — wzorem układu Robloxa, ale we
własnej, stonowanej oprawie (bez neonów i „vibe coded” gradientów):

- górny pasek z wyszukiwarką (`/` focus), nickiem i przyciskiem wejścia do lobby,
- lewy pasek z nawigacją, kategoriami (Horror, Towarzyskie, Wyścigi, Platformówki,
  Kreatywne) i panelem „Znajomi online",
- karuzela wyróżnionych światów: 6 slajdów z własnymi claimami, licznikiem `01 / 06`,
  strzałkami, kropkami i pauzą po najechaniu,
- sekcja **„Ostatnio odwiedzane"** — zapisuje 3 ostatnie światy w `localStorage`
  (`rejplay:recent`) i pozwala jednym kliknięciem do nich wrócić,
- siatka **6 kafelków**, każdy z własną, wygenerowaną okładką, metrykami w stylu
  platformy (`Ocena 94%`, `128 gra teraz` albo `342 czeka na start`), liczbą graczy
  i statusem `Działa` / `Wkrótce`,
- sortowanie: Popularność / Najnowsze / Nazwa A–Z / Najlepiej oceniane,
- kafelek z live podglądem postaci, szybka konfiguracja nicku / stylu / koloru
  oraz blok „Jak to działa".

**Klimat konkretnej gry nie rozlewa się na tło całej strony** — grafiki horroru
pojawiają się tylko w kafelku wyróżnionym i miniaturce gry.

### Edytor postaci

`Edytor` w górnym pasku, `Edytuj postać` na stronie głównej lub `Edytuj wygląd`
na podglądzie. Zmiany widać natychmiast na modelu 3D i zapisują się w
`localStorage` (`rejplay:appearance`). Dostępne:

| Grupa | Opcje |
| --- | --- |
| Sylwetka i fryzura | 6 rigowanych modeli Rocketbox (Alicja, Marek, Ewa, Tomek, Nina, Iza) |
| Odcień skóry | 6 tonów, od bardzo jasnej do ciemnej |
| Kolor włosów | czarny, ciemny brąz, brąz, blond, rudy, siwy |
| Ubranie | oryginał + 5 stonowanych barw |

Barwy są nakładane na **sklonowane per instancja materiały** tekstur, więc
zachowane zostają cienie, fałdy ubioru i detale twarzy, a pokolorowanie jednej
postaci nie przebarwia pozostałych. Edytor zbliża kamerę i chowa piedestał
podglądu.

### Lobby `Plaza Kulki`

Przebudowane z neonowego placu na spokojną, filmową scenę: ziarnisty beton,
ciepłe latarnie, zimne światło księżyca, kamienny obelisk i trzy **fizyczne
bramy z plakatami** zamiast świecących pierścieni. Kliknięcie plakatu lub
przycisku `Zimny Ślad · graj` uruchamia grę.

- 5 postaci (Ty + 4 boty), listy graczy, demo czatu,
- `WASD` / strzałki, `Spacja` (skok), przeciąganie myszą (kamera), sterowanie dotykowe,
- `E` lub przycisk **Machaj** — gest bez VR,
- `C` lub **Aparat** — wirtualna kamera orbitująca wokół postaci, `Zrób zdjęcie`
  zapisuje PNG.

### Zimny Ślad — pierwsza grywalna gra

**Oryginalna, autorska gra dochodzeniowa.** Inspiracją jest sam gatunek, a nie
konkretny tytuł: nie używamy nazwy *Phasmophobia*, jej duchów, lore'u, interfejsu,
dźwięków ani assetów Kinetic Games. Wszystkie nazwy, opisy zjaw, dowody,
dźwięki (synteza WebAudio) i geometria domu są napisane od zera.

Pierwszoosobowe dochodzenie w domu przy Wrzosowej 12. Cztery pokoje, korytarz,
latarka i trzy narzędzia. Zbierasz ślady, otwierasz notatnik i składasz raport,
zanim skończą się nerwy.

| Element | Opis |
| --- | --- |
| Narzędzia | `1` Termometr · `2` Miernik pola · `3` Rejestrator |
| Skan | przytrzymaj `E` przez ~1,2 s — wynik: `wykryto` albo `brak śladu` |
| Dowody | Zimny punkt, Zakłócenia pola, Szepty |
| Zjawy | Mara, Iskra, Szron, Cisza — każda ma własny, unikalny zestaw śladów |
| Nerwy | maleją z czasem, szybciej po ciemku i w trakcie zjawisk |
| Zdarzenia | migotanie latarki, zimno, stuknięcie, półprzezroczysta sylwetka |
| Raport | `J` → wybierz zjawę zgodną ze śladami; pomyłka kosztuje 24 nerwy |

Sterowanie: `WASD` + mysz (`movementX/Y`, bez pointer locku — HUD pozostaje klikalny), `Shift` bieg, `F` latarka, `J` notatnik,
`Esc` / `← Wyjdź` powrót do lobby. Na dotyku działa joystick i przyciski
`Skanuj`, `Narzędzie`, `Notatnik`, `Latarka`.

---

## Sterowanie — skrót

| Klawisz | Akcja |
| --- | --- |
| `/` | focus na wyszukiwarce gier (strona główna) |
| `W A S D`, strzałki | ruch w lobby i w grze |
| `Spacja` | skok w lobby |
| `E` | machnięcie (lobby) / skanowanie, przytrzymaj (gra) |
| `C` | tryb wirtualnego aparatu (lobby) |
| `1` `2` `3` | wybór narzędzia (gra) |
| `F` | latarka (gra) |
| `J` / `Tab` | notatnik (gra) |
| `Shift` | bieg (gra) |
| `Esc` | zamknięcie edytora / wyjście z gry / powrót na stronę główną |

---

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # dist/
npm run preview
```

Wymagany Node 20+. Modele 3D i grafiki są już w `public/`, więc aplikacja nie
pobiera niczego z zewnętrznych CDN w trakcie działania.

---

## Struktura

```
index.html            katalog, lobby, ekran gry, edytor, overlay startowy
src/style.css         jasny katalog + ciemne, filmowe widoki pełnoekranowe
src/main.ts           stan UI, wyszukiwarka, kategorie, karuzela, HUD gry, boot
src/games.ts          katalog światów, paleta, presety wyglądu, boty
src/world.ts          jeden renderer, 3 sceny (home / lobby / gra), kamery, input
src/character.ts      slot gracza: awatar realistyczny + klasyczny, wygląd
src/human.ts          ładowanie Rocketbox GLB, tekstury, animacje, barwienie
src/avatar.ts         klasyczny awatar z sześciu kulek + etykiety
src/horror.ts         Zimny Ślad: geometria domu, silnik, HUD-state, dźwięk
public/characters/    8 modeli Rocketbox GLB + tekstury + biblioteki animacji
public/art/           7 własnych, wygenerowanych grafik (hero, dom, plaza,
                      tor, platformy, miasto, pracownia)
```

---

## Asset i licencje

- **Postacie**: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
  — MIT, `Copyright (c) 2020 Microsoft`. Pliki GLB i tekstury pochodzą z
  konwersji w repozytorium `KunalSiyag/gridfall` (MIT), które w `PROVENANCE.json`
  wskazuje na commit Rocketbox `0943055…`. Pełna treść licencji:
  `public/characters/LICENSE-rocketbox-MIT.txt`.
- **Grafiki** w `public/art/` (`hero.jpg`, `house.jpg`, `plaza.jpg`, `race.jpg`,
  `obby.jpg`, `city.jpg`, `studio.jpg`) są wygenerowanymi, oryginalnymi
  ilustracjami dla tego prototypu.
- **Dźwięki** w grze są syntetyzowane w locie (`AudioContext`), bez plików audio.
- Three.js, Vite i TypeScript — własne licencje open source w `node_modules`.

### Uczciwie o „realistycznych postaciach”

| Mamy | Czego nie mamy |
| --- | --- |
| Rigowane, teksturowane sylwetki 1,75 m, mapy albedo/normal/alpha | Skanu fotogrametrycznego konkretnej osoby |
| Animacje motion capture: idle, chód, machanie | Mimiki twarzy i tracking dłoni z kamery |
| 6 sylwetek, kolor skóry / włosów / ubioru | Pełnego kreatora twarzy, wagi, wieku |
| Jeden wspólny renderer i PBR-owe światła | Metahuman / silnika typu Unreal w przeglądarce |

To najwierniejszy realistyczny wygląd możliwy w lekkim prototypie bez setek
megabajtów assetów. `podgląd kamery` z wątku VRChat zinterpretowaliśmy jako
**wirtualną kamerę orbitującą + machnięcie z klawiatury** — nie dodajemy
`getUserMedia`, zgód na kamerę ani rozpoznawania gestów bez wyraźnej decyzji.

---

## Roadmapa (poza tym slice'm)

- Prawdziwe pokoje multiplayer (Colyseus / WebSocket) zamiast botów,
- profile, znajomi, zapis postaci i świata w bazie (Supabase),
- edytor świata i piaskownica UGC z bezpiecznym skryptowaniem (QuickJS/WASM),
- fizyka (Rapier), kolejne gry z katalogu, system osiągnięć,
- optymalizacja: LOD modeli, code-splitting Three.js, lazy load scen gry.

`Kontynuuj` — zachowujemy dotychczasowe commity, realistyczne awatary, machanie,
aparat, lobby i katalog. Kolejne światy powstają jako osobne sceny, nie jako
motyw przewodni całej strony.

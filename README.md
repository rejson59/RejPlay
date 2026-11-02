# RejPlay

Moje mini gierki :) — przeglądarkowa platforma do grania i tworzenia. Prototyp
(vertical slice 0): **ekran główny + lobby 3D z realistycznymi postaciami**, bez
backendu, bez kont, bez instalacji.

## Uruchomienie

```bash
npm install
npm run dev
```

Vite startuje na `0.0.0.0:5173`. Inne komendy: `npm run build` (typecheck + build),
`npm run preview`. Przy starcie wczytywane są modele postaci (~11 MB z `public/`) —
pojawia się ekran „Wczytywanie postaci…". Jeśli pliki się nie wczytają, aplikacja
automatycznie wraca do klasycznych awatarów z kulek.

## Co działa

- **Dwa style awatarów** — przełącznik na ekranie głównym:
  - `Realistyczne` (domyślny): teksturowane postacie ludzkie z rigiem i animacjami
    motion capture (idle, chód, machanie).
  - `Kulki · klasyk`: oryginalny awatar z 6 kulek (1 głowa, 2 ręce, 1 wydłużona
    na ciało, 2 nogi). Oba style trwają jednocześnie w jednym „slocie" gracza,
    więc przełączenie jest natychmiastowe.
- **Home screen** — żywy podgląd 3D wybranej postaci (przeciągnij, żeby obrócić),
  konfigurator nicku, koloru i stylu (zapis w `localStorage`), katalog 4 gierek.
- **Lobby „Plaza Kulki"** — okrągła plaza, 4 boty z własnymi postaciami i nickami,
  portale do przyszłych gierek, HUD z listą graczy i czatem demo.
- **Gesty bez VR** (pomysł z VRChat) — `E` lub przycisk „Machaj" odtwarza klip
  motion capture `wave`; boty też co jakiś czas machają same. Nad awatarem pojawia
  się komunikat, a gest widać z każdej kamery.
- **Tryb kamery** — `C` włącza wirtualną kamerę: HUD znika, pojawia się wizjer,
  przeciąganie ustawia kadr, kółko myszki robi zoom, `E` pozwala machnąć do zdjęcia,
  a „Zrób zdjęcie" zapisuje PNG (`renderer` ma `preserveDrawingBuffer`).
- **Sterowanie** — `WASD` / strzałki, `Spacja` = skok, przeciągnięcie = kamera,
  `Esc` = wyjście. Na dotyku: joystick, skok, machanie i kamera.

## Jak bardzo „realistyczne"? — uczciwie

Użyte postacie to **prawdziwe, fototeksturowane modele ludzi** (skany z biblioteki
Microsoft Rocketbox): twarze, ubrania, włosy, normal mapy, szkielet i animacje
motion capture. To ogromny skok względem kulek, ale **to nie jest „dosłownie jak
w prawdziwym życiu"** i warto wiedzieć dlaczego:

| | Mamy teraz | „Jak w życiu" (MetaHuman / skan 4K) |
|---|---|---|
| Model | ~300–400 KB siatki + 4 tekstury JPG | 50–200 MB na postać, 4K/8K PBR |
| Skóra | standard PBR + normal mapa | subsurface scattering, mikro-detale, włosy jako hair cards |
| Twarz | statyczna, bez mimiki | 50+ blendshapeów, śledzenie twarzy, sync ust |
| Koszt | działa na laptopie w WebGL | często wymaga dedykowanego GPU / Unreal + pixel streaming |
| Licencja | MIT, do użytku także komercyjnego | płatne licencje, zakaz redystrybucji surowych assetów |

Dodatkowo: nawet VRChat i Roblox **celowo** unikają fotorealizmu (uncanny valley,
wydajność, moderacja, wizerunek najmłodszych użytkowników). Jeśli kiedyś
zdecydujesz się na poziom MetaHuman, wystarczy dostarczyć własny plik GLB —
`src/human.ts` ma już gotowy pipeline (GLTFLoader → tekstury → SkeletonUtils →
AnimationMixer), więc podmiana modeli nie wymaga przerabiania lobby.

## Assety i licencja

Modele, tekstury i animacje w `public/characters/` pochodzą z
[Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(MIT, Copyright © 2020 Microsoft), w konwersji do glTF z repozytorium
`KunalSiyag/gridfall` (również MIT). Pełna treść licencji:
[`public/characters/LICENSE-rocketbox-MIT.txt`](public/characters/LICENSE-rocketbox-MIT.txt).
Wszystkie pliki są w repozytorium, więc aplikacja nie pobiera niczego z zewnątrz.

## Struktura

```
index.html          ekran główny + lobby (HUD, gesty, wizjer, ładowanie)
src/main.ts         UI, stan gracza, style, czat, gesty, tryb kamery, dotyk
src/world.ts        jeden WebGLRenderer, dwie sceny, ruch, kamera, portale, foto
src/character.ts    „slot" gracza trzymający oba style awatara
src/human.ts        ładowanie modeli Rocketbox + AnimationMixer (idle/walk/wave)
src/avatar.ts       awatar z 6 kulek + etykiety z nickiem
src/games.ts        dane gierek, paleta, boty
src/style.css       cały interfejs
public/characters/  modele GLB, tekstury, biblioteki animacji, licencja
```

Stack: **Vite + TypeScript + Three.js**. Jeden kontekst WebGL jest przenoszony
między podglądem na home screenie a lobby.

## Co dalej

1. **Prawdziwy multiplayer** — Colyseus (Node + WebSocket), `packages/shared` ze
   wspólnymi typami wiadomości (również dla gestów: „ktoś machnął"), boty zastępują
   gracze z serwera. ⚠️ Serwera WS nie wolno stawiać na Vercel/serverless.
2. **Supabase** — Auth, katalog gier, leaderboardy, zapis świata w Storage.
3. **Edytor światów** — `TransformControls`, publikowanie scen jako JSON.
   To moment, w którym RejPlay staje się platformą UGC.
4. **Wybór postaci przez gracza** — zamiast jednego modelu na slot: galeria
   awatarów, zapis wyboru w profilu, własny GLB wrzucany przez użytkownika
   (wymaga walidacji rozmiaru i moderacji).
5. Dopiero na końcu: czat sieciowy z moderacją, profil, ekonomia (RODO/regulamin).

Dane gracza, boty, czat i gesty są obecnie lokalne i oznaczone jako demo.

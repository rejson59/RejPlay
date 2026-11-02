# RejPlay

Moje mini gierki :) — przeglądarkowa platforma do grania i tworzenia, startująca od
**ekranu głównego + lobby 3D**. Prototyp (vertical slice 0): bez backendu, bez kont,
bez instalacji. Wszystko działa lokalnie w przeglądarce.

## Uruchomienie

```bash
npm install
npm run dev
```

Vite startuje na `0.0.0.0:5173`. Inne komendy: `npm run build` (typecheck + build),
`npm run preview`.

## Co już działa

- **Home screen** — hero z żywym podglądem awatara 3D (przeciągnij, żeby obrócić),
  konfigurator nicku i koloru (zapis w `localStorage`), katalog 4 gierek, sekcja
  „przepis na awatara".
- **Lobby „Plaza Kulki"** — pełnoekranowa scena 3D: okrągła plaza, dekoracyjne kulki,
  trzy kolorowe portale do przyszłych gierek, 4 lokalne boty z nickami nad głowami.
- **Sterowanie** — `WASD` / strzałki = ruch, `Spacja` = skok, przeciągnięcie myszką =
  obrót kamery, klik w portal = wybór gierki. Na urządzeniach dotykowych pojawia się
  joystick i przycisk skoku. `Esc` wraca na ekran główny.
- **HUD** — lista graczy, czat demo (lokalny, bez serwera), podpowiedzi sterowania,
  komunikaty toast.

## Awatar: 6 kulek

Dokładnie tak, jak w pomyśle wyjściowym — żadnych importowanych modeli ani rigów:

| # | Część | Geometria |
|---|-------|-----------|
| 1 | głowa | 1 kulka (`SphereGeometry`) |
| 2–3 | ręce | po 1 kulce na stronę, na zawiasach w ramionach (machają przy ruchu) |
| 4 | ciało | 1 kulka **rozciągnięta w osi Y** — jedyna nieokrągła część |
| 5–6 | nogi | 2 kulki na zawiasach (toczą się naprzemiennie) |

Implementacja: [`src/avatar.ts`](src/avatar.ts). Każdy awatar ma 3 materiały
(jaśniejsza głowa, bazowe ciało, ciemniejsze kończyny) wyliczane z jednego koloru,
dzięki czemu zmiana koloru w konfiguratorze działa natychmiast.

## Struktura

```
index.html          ekran główny + lobby (HUD)
src/main.ts         UI, stan gracza, katalog gier, czat, sterowanie dotykowe
src/world.ts        jeden WebGLRenderer, dwie sceny (hero + lobby), ruch, kamera, portale
src/avatar.ts       awatar z 6 kulek + etykiety z nickiem (sprite)
src/games.ts        dane gierek, paleta kolorów, boty
src/style.css       cały interfejs
```

Stack: **Vite + TypeScript + Three.js**. Jeden kontekst WebGL jest przenoszany między
podglądem na home screenie a lobby, więc przełączanie ekranów jest darmowe.

## Co dalej (roadmapa)

1. **Prawdziwy multiplayer** — Colyseus (Node + WebSocket), `packages/shared` ze
   wspólnymi typami wiadomości, boty z lobby zastępują gracze z serwera.
   ⚠️ Serwera WS nie wolno stawiać na Vercel/serverless — potrzebny jest stale
   działający proces (Fly.io / Railway / VM).
2. **Supabase** — Auth zamiast `localStorage`, katalog gier i leaderboardy w Postgres,
   zapis scen w Storage.
3. **Edytor światów w przeglądarce** — dodawanie i przesuwanie kulek
   (`TransformControls`), publikowanie sceny jako JSON. To moment, w którym RejPlay
   staje się platformą UGC, a nie tylko zbiorem gierek.
4. **Skrypty użytkowników w sandboxie** (QuickJS/WASM, nigdy `eval`), moderacja,
   profile, czat sieciowy. Na końcu ewentualna ekonomia (wymaga RODO/regulaminu).

Obecnie dane (nick, kolor, gra, boty, czat) są lokalne i celowo oznaczone jako demo.

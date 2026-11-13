# RejPlay · Gabinet Osobliwości

Cztery kompletne, autorskie gry przeglądarkowe w jednym gabinecie. Nie ma tu ani jednego pliku grafiki, modelu, tekstury, nagrania ani fontu z sieci: cała geometria, światło, faktury, dźwięki i drony są liczone w przeglądarce (Canvas 2D, SVG, CSS, WebAudio). Nie ma też serwera, konta ani zależności runtime — postęp (rekordy i liczba partii) zostaje w `localStorage` tego urządzenia.

Wejdź na półkę, wybierz pozycję, przeczytaj wstęp pod znakiem `?` w prawym górnym rogu. `Esc` zawsze wraca na półkę.

---

## I · Centrala

**Analogowy thriller szpiegowski · jedno pomieszczenie · dedukcja**

Noc, lata pięćdziesiąte, górski kurort odcięty przez lawinę. Siedzisz na poddaszu hotelu Alpenrose przed tablicą z dwunastoma gniazdami i nie wychodzisz z pokoju przez całą partię. W hotelu ktoś zabił gościa; wśród gości są szpieg, konsul, politycy i przestępcy. Jedynym oknem na świat jest centrala.

* **Przepinaj kable.** Kliknij dwa gniazda albo przeciągnij między nimi wtyczkę. Dzwoniący abonent ma pulsującą lampkę. Możesz też **wymusić rozmowę między dowolną parą** — np. połączyć sprawcę z posterunkiem albo z kolejną ofiarą. Taki mostek tworzy nową rozmowę, dodaje trop i zmienia bieg nocy, ale zostawia słyszalny klik.
* **Podsłuchuj ostrożnie.** Dźwignia podsłuchu odsłania kolejne zdania i zapisuje tropy w notesie. Każde przełączenie może wygenerować klik: szpieg słyszy go najlepiej. Podejrzenia rosną do 100% — wtedy goście odcinają centralę.
* **Nagrywaj i montuj.** Aktywną linię nagrywasz na szpulę, dwie szpule tniesz i sklejasz w nową taśmę, a potem puszczasz ją wybranemu gościowi. Policja dostaje patrol, sprawca słyszy własny głos, szpieg przestaje ufać wspólnikowi, świadek dopisuje zeznanie.
* **Zarządzaj hotelem.** Winda, prąd na III piętrze, światła w holu, kocioł. Zablokowanie windy lub odcięcie prądu ratuje drugą ofiarę; wyłączenie kotła wyostrza słuch wszystkich gości.
* **Złóż raport.** Wskaż sprawcę, motyw i dowód rzeczowy. Wynik zależy od tropów, uratowanej ofiary, podejrzeń i tego, czy udało Ci się zdemaskować sprawcę taśmą.

Noc trwa 120 sekund (1 s = 2 minuty gry) w trzech aktach; raport możesz złożyć wcześniej.

## II · Pasożyt

**Biologiczny city-builder · żywa mapa · balans chciwości**

Twoja kolonia rośnie wewnątrz stworzenia wielkości kontynentu, które wędruje przez jałowy świat. Nie ma stali, betonu ani prądu: wapń pochodzi z kości, tlen i hormony z krwi i narządów, biomasa z tkanki. Mapa nie jest terenem — oddycha, ma tętno, zapalenie, gorączkę i może umrzeć.

* **Osiem struktur**, każda z kosztem, utrzymaniem i kosztem biologicznym: kopalnia wapnia tylko na kości, pompa na naczyniu, gruczoł na narządzie, farma na tkance, łata na ranie, węzeł termoregulacji na węźle nerwowym, gniazdo i wieża immunosupresyjna.
* **Zapalenie rozlewa się** po sąsiednich polach, a jego średnia podnosi gorączkę. Powyżej 39 °C gospodarz traci zdrowie co cykl.
* **Układ odpornościowy** wysyła leukocyty, które idą po najbliższy budynek i niszczą go jak infekcję. Wieże rozpylają immunosupresant, wyciszają zapalenie i zabijają krwinki w promieniu dwóch pól.
* **Zdarzenia co 22 cykle**: drapieżnik z zewnątrz rozrywa ścianę ciała, skok odporności, gorączka nocna. Decyzja zamraża symulację — nie da się jej przeczekać.
* **Cel:** 240 cykli symbiozy. Śmierć gospodarza kończy grę, więc agresywna rozbudowa jest najkrótszą drogą do przegranej.

Sterowanie: paleta → klik na polu, prawy przycisk rozwiązuje strukturę, `⏸` / `1×` / `2×` / `4×` zmieniają tempo.

## III · Głuchy Świat

**Skrytobójstwo oparte na fizyce dźwięku · FPP · echolokacja**

Podziemny, brutalistyczny świat gigantycznych jaskiń, surowego betonu i mosiądzu. Nikt tu nie widzi. Ekran jest w większości czarny: punkty betonu, metalu, wody, szkła i wyjścia pojawiają się dopiero wtedy, gdy **wróci do Ciebie fala**, którą sam wypuściłeś. Opóźnienie rośnie z odległością, a barwa i czas wygasania zależą od materiału. Dźwięk jest jednocześnie światłem i zdradą.

* **Siedem narzędzi:** pstryknięcie (nieskończone, tanie), kamień (hałas w oddali — oświetla, nie zdradza pozycji), kamerton (najdalej, najgłośniej), **mikrofon kierunkowy** (wąski, prawie bezszelestny stożek), dywan (wycisza kroki na potłuczonym szkle), mechaniczna zabawka (tyka przez 7 s **w innym korytarzu**), zagłuszacz (ogłusza Słuchaczy na 4,5 s).
* **Słuchacze** reagują na głośność i odległość: przechodzą od wędrówki przez badanie do pościgu. Skradanie (`Shift`) jest wolniejsze, ale cichsze.
* **Trzy poziomy** proceduralnych jaskiń z BFS-gwarancją przejścia do wyjścia. Złapanie kończy grę; czas, liczba usłyszeń i kroków obniżają wynik.

Sterowanie: `W`/`S` lub `↑`/`↓` ruch, `A`/`D` lub `←`/`→` (albo mysz) obrót, `Spacja`/`1` pstryknięcie, `1`–`7` narzędzia. Na ekranach dotykowych dostępne jest pokrętło i przyciski.

## IV · Amnezja Pojęciowa

**Surrealistyczna przygoda logiczna · puzzle RPG · obrażenia zmieniają zasady**

Wiktoriański dwór dotknęła Plaga Pojęć. Nie masz punktów zdrowia. Masz dziesięć pojęć: czerwień, liczby, drzwi, klucze, imiona, pismo, światło, czas, strach, woda. Porażka w pojedynku z Cenzorem nie zabija — **kasuje pojęcie**, a wraz z nim regułę świata.

* Utracona **czerwień** szarzeje w opisach i w CSS; bez **liczb** cyfry i ilości zamieniają się w `§`; bez **Drzwi** znika przycisk „Otwórz", a drzwi stają się „gładką częścią ściany" — ale witrażowe okno wciąż można wybić i przecisnąć się przez nie.
* `render()` zniekształca tekst w locie, `verbs()` dosłownie usuwa akcje, `exits()` blokuje przejścia. Brak pojęcia to zagadka z alternatywną drogą, nigdy mur i nigdy wczytanie zapisu.
* **Kradnij i handluj pojęciami.** Odłamek z witrażu podważa słoiki Handlarza; księga odwraca uwagę Cenzora; trafna odpowiedź w pojedynku odbiera strażnikowi jedno z utraconych pojęć.
* Dziewięć pokoi, trzy duele, trzy zakończenia: dwa wygrane (z wypowiedzianym imieniem albo bez niego) oraz rozpad umysłu. Wynik rośnie za zachowane pojęcia, odkryte fakty i wygrane pojedynki.

---

## Architektura

```
index.html
src/
  main.ts                 hub, routing po hashu, rekordy, globalny dźwięk
  style.css               jedyny arkusz (także efekty utraconych pojęć)
  core/                   random, save, dom, audio, types, shell
  logic/                  czyste silniki bez DOM: centrala, pasozyt,
                          gluchy, amnezja  ← tu są wszystkie zasady
  games/                  adaptery Game: rysowanie, wejście, rAF, toasty
tests/                    node:test + jsdom; hak resolucji dla .ts/.css
```

Silniki w `src/logic/` nie znają `document`, `window` ani dźwięku, dzięki czemu są testowalne w czystym Node. Warstwa `src/games/` tylko je wizualizuje i tłumaczy kliknięcia na wywołania. To rozdzielenie pozwala zmieniać zasady bez dotykania interfejsu.

Dźwięk generuje `AudioEngine`: 19 barw (przekaźniki, szpule, beton, metal, woda, szkło, krew, szept…) i cztery drony, każdy z własnymi oscylatorami. Wszystko powstaje w `AudioContext` po pierwszym geście użytkownika; przełącznik `🔊` zapisuje wyciszenie w `localStorage`.

## Uruchomienie

```bash
npm ci
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # 23 testy: silniki + smoke-test UI w jsdom
npm run build      # dist/ gotowy do GitHub Pages (base /RejPlay/)
npm run preview
```

Wymagania: Node 22+, przeglądarka z Canvas 2D, SVG i WebAudio. `jsdom`, `typescript` i `vite` są wyłącznie zależnościami deweloperskimi; wyprodukowany `dist/` nie ma żadnej zależności runtime.

Workflow Pages (`verify + deploy`) odpala `npm ci`, typecheck, testy i build przy każdym PR oraz wdraża `dist` po pushu na `main`.

## Sterowanie w skrócie

| Gra | Najważniejsze |
| --- | --- |
| Centrala | klik dwa gniazda / przeciągnij kabel · dźwignia podsłuchu · nagraj, zmontuj, puść taśmę · systemy hotelu · raport |
| Pasożyt | paleta → pole · prawy przycisk = rozwiąż · tempo 1×/2×/4× |
| Głuchy Świat | `Spacja` = pstryknięcie · `W`/`S`, `A`/`D`, `Shift` · `1`–`7` narzędzia |
| Amnezja | klik czasownik przy przedmiocie · klik kierunku wyjścia · okno dialogowe wymiany/pojedynku |

Wszystkie gry: `← Gabinet` w lewym górnym rogu lub `Esc`, `?` = wstęp, `🔊` = wyciszenie.

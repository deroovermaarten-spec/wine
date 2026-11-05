# Meerstraat wines

Een wijnkelder-app voor de telefoon: wijnen scannen en invoeren, scores, voorraad,
drinkvensters, proefmomenten, verlanglijst en inzichten. Gebouwd als installeerbare
web-app (PWA): alles staat op het toestel zelf en werkt ook zonder internet.

## Installeren op je telefoon

1. Open de app-link in **Safari** (iPhone) of **Chrome** (Android).
2. iPhone: tik op Delen → **Zet op beginscherm**. Android: menu ⋮ → **App installeren**.
3. Open de app vanaf je beginscherm.

## Je wijnen overzetten uit de Claude-versie

1. Open Meerstraat wines op claude.ai → **Inzichten** → onderaan **Back-up** → **Download back-upbestand**.
2. Bewaar het bestand op je telefoon (bv. in Bestanden / iCloud Drive).
3. Open de geïnstalleerde app → **Inzichten** → **Back-up terugzetten** en kies het bestand.

Terugzetten is veilig om te herhalen: wijnen die al bestaan worden bijgewerkt, niet verdubbeld.

> Op een iPhone heeft de app op het beginscherm een eigen opslag, los van Safari.
> Zet je back-up dus terug *in* de geïnstalleerde app.

## Slimme functies (Gemini, gratis)

Etiket herkennen, "Wat drink ik vanavond?", de Vraag-tab, het weetje van de dag,
gerechten, info over het wijnhuis en de winkeltip werken met een gratis sleutel van Google Gemini:

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) en maak een sleutel aan.
2. In de app: tandwiel rechtsboven → plak de sleutel → **Bewaar**.

De sleutel blijft alleen op het toestel (niet in deze repo). Bij gratis gebruik geldt een daglimiet
en mag Google de vragen en foto's gebruiken om hun AI te verbeteren.

Zonder sleutel, zonder internet of als de limiet bereikt is, leest de app het etiket met
gratis tekstherkenning op de telefoon (Tesseract): jaargang, streek, land, type en druif worden
ingevuld en elke gelezen regel verschijnt als knopje om in een veld te zetten.

Niet beschikbaar buiten Claude: de publieke deellink en "wijnhandels in de buurt".

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De app (zelfde code als de Claude-versie) |
| `store.js` | Opslag op het toestel (IndexedDB) in plaats van de Claude-database |
| `ai.js` | Gemini-koppeling met je eigen sleutel |
| `ocr.js`, `vendor/tesseract/` | Gratis tekstherkenning op het toestel |
| `sw.js` | Offline werken |
| `world.json` | Wereldkaart voor Inzichten |
| `manifest.webmanifest`, `icons/` | Naam en icoon op het beginscherm |
| `.github/workflows/pages.yml` | Publiceert de app op GitHub Pages bij elke push |

Lokaal testen: `python3 -m http.server` in deze map en open `http://localhost:8000`.

# Mijn wijnkelder

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

## Etiket scannen

"Scan een fles" laat Claude het etiket herkennen (zie hieronder). Staan de slimme functies uit,
dan vul je de gegevens zelf in bij de foto.

Offline (bv. in de kelder) tik je op **Later herkennen**: de fles wordt meteen bewaard met wat je
invulde (voorraad, plaats…) en krijgt het label "Wacht op herkenning". De foto blijft op die telefoon
staan (IndexedDB `mw-scan-queue`). Zodra die telefoon weer online is, vult Claude de lege velden aan.

## Updates

Bij elke push vult de workflow een nieuw versienummer in `sw.js` in (`__BUILD__` wordt de commit-id).
Telefoons zien dan "Er is een nieuwe versie" en vernieuwen pas als je erop tikt. Lokaal blijft het
`__BUILD__`: dan komen de app-bestanden altijd vers van de schijf.
Bibliotheken en lettertypes (`vendor/`, `fonts/`) zitten in een aparte cache die updates overleeft;
verhoog `LIBS` in `sw.js` alleen als je daar zelf een bestand vervangt.

## Snelkoppelingen

Lang drukken op het app-icoon (Android, en Chrome op de computer) toont "Vanavond", "Verlanglijst" en "Inzichten".

## Slimme functies met Claude (betalen per gebruik)

Etiket herkennen, "Wat drink ik vanavond?", de Vraag-tab, het weetje, gerechten en wijnhuis-info gebruiken Claude
via een kleine tussenserver (`worker/worker.js`, Cloudflare Workers, gratis). Daar staat de API-sleutel; telefoons
krijgen hem nooit te zien. Alleen aangemelde leden van een kelder van de eigenaar (`OWNER_UID`) mogen hem gebruiken,
met een daglimiet per persoon. Zolang `window.MW_AI_URL` in `firebase-config.js` leeg is, staan de functies uit.

1. console.anthropic.com: tegoed kopen (Billing), een maandlimiet zetten (Limits) en een API-sleutel maken.
2. dash.cloudflare.com: Workers & Pages → Create → Worker, plak `worker/worker.js`, Deploy.
3. In de Worker: Settings → Variables and Secrets: `ANTHROPIC_API_KEY` (Secret), `OWNER_UID` (je Gebruikers-id uit het kelder-menu), `FIREBASE_PROJECT` = `meerstraat-wines`.
4. Zet het adres van de Worker (`https://….workers.dev`) in `window.MW_AI_URL`.

## Wat niet werkt buiten Claude

De publieke deellink en "wijnhandels in de buurt" staan uit. Die blijven beschikbaar in de Claude-versie van Meerstraat wines.

## Aanmelden en kelders delen

Met een Firebase-project (gratis) kan iedereen een eigen account maken. Elk account krijgt een eigen kelder,
en via "Uitnodigen" in het kelder-menu (knop bovenaan) deel je een kelder met iemand anders.
Zolang `firebase-config.js` leeg is (`window.MW_FIREBASE = null`) werkt de app zoals voorheen, alleen op de telefoon.

Eenmalig instellen:

1. Maak een project op [console.firebase.google.com](https://console.firebase.google.com).
2. Voeg een Web-app toe en kopieer de `firebaseConfig` naar `firebase-config.js` (die gegevens zijn niet geheim).
3. Authentication → Sign-in method → E-mail/wachtwoord aanzetten.
4. Firestore Database aanmaken (regio in Europa, productiemodus).
5. Firestore → Rules: plak de inhoud van `firestore.rules` en klik Publish.
6. Authentication → Settings → Authorized domains: voeg `deroovermaarten-spec.github.io` toe.

Bestaande wijnen op de telefoon zet je over met "Zet ze in deze kelder" in het kelder-menu, of via een backupbestand.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De app (zelfde code als de Claude-versie) |
| `store.js` | Opslag op het toestel (IndexedDB) in plaats van de Claude-database |
| `sw.js` | Offline werken en updates |
| `fonts/` | De lettertypes, zelf gehost zodat ze offline werken |
| `world.json` | Wereldkaart voor Inzichten |
| `manifest.webmanifest`, `icons/` | Naam en icoon op het beginscherm |
| `.github/workflows/pages.yml` | Publiceert de app op GitHub Pages bij elke push |
| `cloud.js`, `firebase-config.js`, `vendor/firebase/` | Aanmelden en gedeelde kelders (Firebase) |
| `firestore.rules` | Beveiligingsregels om in Firebase te plakken |

Lokaal testen: `python3 -m http.server` in deze map en open `http://localhost:8000`.

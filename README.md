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

## Herinneringen (melding als een fles op moet)

In "Klaar om te drinken" staat **Stuur me een herinnering**. Je krijgt dan een melding op je telefoon, ook als
de app dicht is: drie dagen nadat je een fles opende, en de eerste vrijdag van de maand als er wijnen binnenkort
of nu gedronken moeten worden. Op een iPhone werkt dit alleen in de app op je beginscherm (iOS 16.4 of nieuwer).

In **Instellingen → Herinneringen** zet je ze aan of uit per telefoon, kies je na hoeveel dagen een open fles een
melding geeft (2, 3, 5 of niet), hoe vaak je hoort welke flessen op moeten (elke vrijdag, de eerste vrijdag van de
maand of niet) en hoe laat (9, 12, 18 of 20 u). Daar zie je ook de volgende geplande melding en kun je een testmelding sturen.

De tussenserver weet alleen *wanneer* hij je telefoon moet wekken; de tekst van de melding maakt de telefoon zelf
uit wat hij over je kelder weet. Eenmalig instellen in Cloudflare (bij de Worker van de slimme functies):

1. Plak de nieuwe `worker/worker.js` in de Worker en klik Deploy.
2. Storage & Databases → KV → Create namespace, bv. `meerstraat-push`.
3. In de Worker: Settings → Bindings → Add → KV namespace. Variabelenaam `PUSH`, kies de namespace van stap 2.
4. In de Worker: Settings → Triggers → Cron Triggers → Add: `0 * * * *` (elk uur).

De sleutels voor meldingen (VAPID) maakt de Worker zelf bij het eerste gebruik en bewaart ze in `PUSH`.
Zolang stap 2 tot 4 niet gedaan zijn, zegt de app "Herinneringen zijn nog niet ingesteld op de server".

## Jouw wijnjaar

Bij Inzichten: hoeveel keer je dronk, je beste glas, per maand, kleur, landen, druiven en wat nieuw was.
Het telt elke fles die je opent of met − afboekt (bijgehouden sinds november 2026) en je proefmomenten.

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

In een gedeelde kelder geeft iedereen zijn eigen score (`scores.<gebruikers-id>` bij de wijn; het oude veld `score`
blijft de score van de eigenaar). Ook leden die geen wijnen mogen wijzigen, kunnen scoren. Voorraad, gedronken flessen en
proefmomenten worden met "één erbij / één eraf" bewaard, zodat twee mensen tegelijk elkaars werk niet overschrijven.

Profielen (`users/`) zijn alleen voor jezelf leesbaar. Om gevonden te worden voor een tip, bewaart de app enkel je naam
onder je e-mailadres (`emails/`): wie het exacte adres kent, vindt je; niemand kan de lijst opvragen.
Pas je `firestore.rules` aan, plak ze dan opnieuw in Firebase (stap 5).

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
| `remind.js` | Herinneringen: plant meldingen voor flessen die op moeten |
| `events.js` | Events: samen een wijnlijst opstellen voor een etentje of proefavond |
| `firestore.rules` | Beveiligingsregels om in Firebase te plakken |

Lokaal testen: `python3 -m http.server` in deze map en open `http://localhost:8000`.

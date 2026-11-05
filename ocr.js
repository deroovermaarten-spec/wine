/*
 * Meerstraat wines — free label reading on the phone.
 *
 * Tesseract (OCR) reads the text on the label, entirely on the device: no API key,
 * no credits, and after the first scan it also works offline. OCR reads letters but
 * does not know wine, so this file adds a small wine dictionary to turn the text into
 * fields: vintage, appellation → region/country (and the usual grape and colour),
 * country, colour and grape words. Name and producer are guessed from the largest
 * lines; every line is also offered as a tap-to-fill chip in the form.
 */
(() => {
  const BASE = new URL("vendor/tesseract/", document.baseURI).href;
  const YEAR = new Date().getFullYear();
  const nrm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const wordsOf = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

  // ---- wine dictionary ---------------------------------------------------
  // appellation | region shown | country | colour (optional) | usual grape (optional)
  const APP = `
Champagne|Champagne|Frankrijk|mousserend|Chardonnay, Pinot Noir, Pinot Meunier
Crémant de Bourgogne|Bourgogne|Frankrijk|mousserend|
Crémant d'Alsace|Elzas|Frankrijk|mousserend|
Crémant de Loire|Loire|Frankrijk|mousserend|
Crémant de Limoux|Languedoc|Frankrijk|mousserend|
Chablis|Chablis, Bourgogne|Frankrijk|wit|Chardonnay
Meursault|Meursault, Bourgogne|Frankrijk|wit|Chardonnay
Puligny-Montrachet|Puligny-Montrachet, Bourgogne|Frankrijk|wit|Chardonnay
Chassagne-Montrachet|Chassagne-Montrachet, Bourgogne|Frankrijk||
Pouilly-Fuissé|Pouilly-Fuissé, Bourgogne|Frankrijk|wit|Chardonnay
Saint-Véran|Mâconnais, Bourgogne|Frankrijk|wit|Chardonnay
Mâcon|Mâconnais, Bourgogne|Frankrijk||
Gevrey-Chambertin|Gevrey-Chambertin, Bourgogne|Frankrijk|rood|Pinot Noir
Chambolle-Musigny|Chambolle-Musigny, Bourgogne|Frankrijk|rood|Pinot Noir
Vosne-Romanée|Vosne-Romanée, Bourgogne|Frankrijk|rood|Pinot Noir
Nuits-Saint-Georges|Nuits-Saint-Georges, Bourgogne|Frankrijk|rood|Pinot Noir
Pommard|Pommard, Bourgogne|Frankrijk|rood|Pinot Noir
Volnay|Volnay, Bourgogne|Frankrijk|rood|Pinot Noir
Beaune|Beaune, Bourgogne|Frankrijk||
Santenay|Santenay, Bourgogne|Frankrijk||
Mercurey|Mercurey, Bourgogne|Frankrijk||
Givry|Givry, Bourgogne|Frankrijk||
Bourgogne Aligoté|Bourgogne|Frankrijk|wit|Aligoté
Bourgogne|Bourgogne|Frankrijk||
Beaujolais|Beaujolais|Frankrijk|rood|Gamay
Morgon|Morgon, Beaujolais|Frankrijk|rood|Gamay
Fleurie|Fleurie, Beaujolais|Frankrijk|rood|Gamay
Moulin-à-Vent|Moulin-à-Vent, Beaujolais|Frankrijk|rood|Gamay
Brouilly|Brouilly, Beaujolais|Frankrijk|rood|Gamay
Juliénas|Juliénas, Beaujolais|Frankrijk|rood|Gamay
Saint-Amour|Saint-Amour, Beaujolais|Frankrijk|rood|Gamay
Chiroubles|Chiroubles, Beaujolais|Frankrijk|rood|Gamay
Régnié|Régnié, Beaujolais|Frankrijk|rood|Gamay
Chénas|Chénas, Beaujolais|Frankrijk|rood|Gamay
Côte de Brouilly|Côte de Brouilly, Beaujolais|Frankrijk|rood|Gamay
Pauillac|Pauillac, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Margaux|Margaux, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Saint-Julien|Saint-Julien, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Saint-Estèphe|Saint-Estèphe, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Haut-Médoc|Haut-Médoc, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Médoc|Médoc, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Listrac-Médoc|Listrac-Médoc, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Moulis|Moulis, Bordeaux|Frankrijk|rood|Cabernet Sauvignon, Merlot
Pessac-Léognan|Pessac-Léognan, Bordeaux|Frankrijk||
Graves|Graves, Bordeaux|Frankrijk||
Saint-Émilion Grand Cru|Saint-Émilion, Bordeaux|Frankrijk|rood|Merlot, Cabernet Franc
Saint-Émilion|Saint-Émilion, Bordeaux|Frankrijk|rood|Merlot, Cabernet Franc
Pomerol|Pomerol, Bordeaux|Frankrijk|rood|Merlot, Cabernet Franc
Lalande-de-Pomerol|Lalande-de-Pomerol, Bordeaux|Frankrijk|rood|Merlot
Fronsac|Fronsac, Bordeaux|Frankrijk|rood|Merlot
Côtes de Bourg|Côtes de Bourg, Bordeaux|Frankrijk|rood|Merlot
Blaye|Blaye, Bordeaux|Frankrijk|rood|Merlot
Castillon|Castillon, Bordeaux|Frankrijk|rood|Merlot
Entre-Deux-Mers|Entre-Deux-Mers, Bordeaux|Frankrijk|wit|Sauvignon Blanc, Sémillon
Sauternes|Sauternes, Bordeaux|Frankrijk|dessert|Sémillon, Sauvignon Blanc
Barsac|Barsac, Bordeaux|Frankrijk|dessert|Sémillon
Bordeaux Supérieur|Bordeaux|Frankrijk||
Bordeaux|Bordeaux|Frankrijk||
Bergerac|Bergerac|Frankrijk||
Monbazillac|Monbazillac|Frankrijk|dessert|Sémillon
Cahors|Cahors|Frankrijk|rood|Malbec
Madiran|Madiran|Frankrijk|rood|Tannat
Jurançon|Jurançon|Frankrijk|wit|Petit Manseng, Gros Manseng
Gaillac|Gaillac|Frankrijk||
Sancerre|Sancerre, Loire|Frankrijk|wit|Sauvignon Blanc
Pouilly-Fumé|Pouilly-Fumé, Loire|Frankrijk|wit|Sauvignon Blanc
Menetou-Salon|Menetou-Salon, Loire|Frankrijk||
Quincy|Quincy, Loire|Frankrijk|wit|Sauvignon Blanc
Reuilly|Reuilly, Loire|Frankrijk||
Vouvray|Vouvray, Loire|Frankrijk|wit|Chenin Blanc
Montlouis|Montlouis, Loire|Frankrijk|wit|Chenin Blanc
Savennières|Savennières, Loire|Frankrijk|wit|Chenin Blanc
Saumur-Champigny|Saumur-Champigny, Loire|Frankrijk|rood|Cabernet Franc
Saumur|Saumur, Loire|Frankrijk||
Chinon|Chinon, Loire|Frankrijk|rood|Cabernet Franc
Bourgueil|Bourgueil, Loire|Frankrijk|rood|Cabernet Franc
Muscadet|Muscadet, Loire|Frankrijk|wit|Melon de Bourgogne
Anjou|Anjou, Loire|Frankrijk||
Touraine|Touraine, Loire|Frankrijk||
Coteaux du Layon|Coteaux du Layon, Loire|Frankrijk|dessert|Chenin Blanc
Alsace Grand Cru|Elzas|Frankrijk|wit|
Alsace|Elzas|Frankrijk|wit|
Châteauneuf-du-Pape|Châteauneuf-du-Pape, Rhône|Frankrijk|rood|Grenache, Syrah, Mourvèdre
Gigondas|Gigondas, Rhône|Frankrijk|rood|Grenache, Syrah
Vacqueyras|Vacqueyras, Rhône|Frankrijk|rood|Grenache, Syrah
Rasteau|Rasteau, Rhône|Frankrijk|rood|Grenache
Cairanne|Cairanne, Rhône|Frankrijk|rood|Grenache
Lirac|Lirac, Rhône|Frankrijk||
Tavel|Tavel, Rhône|Frankrijk|rose|Grenache
Côte-Rôtie|Côte-Rôtie, Rhône|Frankrijk|rood|Syrah
Hermitage|Hermitage, Rhône|Frankrijk|rood|Syrah
Crozes-Hermitage|Crozes-Hermitage, Rhône|Frankrijk|rood|Syrah
Saint-Joseph|Saint-Joseph, Rhône|Frankrijk|rood|Syrah
Cornas|Cornas, Rhône|Frankrijk|rood|Syrah
Condrieu|Condrieu, Rhône|Frankrijk|wit|Viognier
Côtes du Rhône Villages|Côtes du Rhône|Frankrijk||
Côtes du Rhône|Côtes du Rhône|Frankrijk||
Ventoux|Ventoux, Rhône|Frankrijk||
Luberon|Luberon, Rhône|Frankrijk||
Costières de Nîmes|Costières de Nîmes, Rhône|Frankrijk||
Bandol|Bandol, Provence|Frankrijk||Mourvèdre
Côtes de Provence|Provence|Frankrijk|rose|Grenache, Cinsault
Coteaux d'Aix-en-Provence|Provence|Frankrijk|rose|
Provence|Provence|Frankrijk|rose|
Pic Saint-Loup|Pic Saint-Loup, Languedoc|Frankrijk|rood|Syrah, Grenache
Minervois|Minervois, Languedoc|Frankrijk|rood|
Corbières|Corbières, Languedoc|Frankrijk|rood|
Fitou|Fitou, Languedoc|Frankrijk|rood|
Faugères|Faugères, Languedoc|Frankrijk|rood|
Saint-Chinian|Saint-Chinian, Languedoc|Frankrijk|rood|
Picpoul de Pinet|Picpoul de Pinet, Languedoc|Frankrijk|wit|Picpoul
Languedoc|Languedoc|Frankrijk||
Pays d'Oc|Pays d'Oc|Frankrijk||
Côtes du Roussillon|Roussillon|Frankrijk||
Collioure|Collioure, Roussillon|Frankrijk||
Banyuls|Banyuls, Roussillon|Frankrijk|dessert|Grenache
Maury|Maury, Roussillon|Frankrijk|dessert|Grenache
Côtes de Gascogne|Gascogne|Frankrijk|wit|
Jura|Jura|Frankrijk||
Arbois|Arbois, Jura|Frankrijk||
Savoie|Savoie|Frankrijk||
Corse|Corsica|Frankrijk||
Chianti Classico|Chianti Classico, Toscane|Italië|rood|Sangiovese
Chianti Rufina|Chianti Rufina, Toscane|Italië|rood|Sangiovese
Chianti|Chianti, Toscane|Italië|rood|Sangiovese
Brunello di Montalcino|Montalcino, Toscane|Italië|rood|Sangiovese
Rosso di Montalcino|Montalcino, Toscane|Italië|rood|Sangiovese
Vino Nobile di Montepulciano|Montepulciano, Toscane|Italië|rood|Sangiovese
Rosso di Montepulciano|Montepulciano, Toscane|Italië|rood|Sangiovese
Bolgheri|Bolgheri, Toscane|Italië|rood|Cabernet Sauvignon, Merlot
Morellino di Scansano|Scansano, Toscane|Italië|rood|Sangiovese
Vernaccia di San Gimignano|San Gimignano, Toscane|Italië|wit|Vernaccia
Maremma|Maremma, Toscane|Italië||
Toscana|Toscane|Italië||
Barolo|Barolo, Piëmont|Italië|rood|Nebbiolo
Barbaresco|Barbaresco, Piëmont|Italië|rood|Nebbiolo
Langhe Nebbiolo|Langhe, Piëmont|Italië|rood|Nebbiolo
Roero Arneis|Roero, Piëmont|Italië|wit|Arneis
Roero|Roero, Piëmont|Italië||
Langhe|Langhe, Piëmont|Italië||
Barbera d'Alba|Alba, Piëmont|Italië|rood|Barbera
Barbera d'Asti|Asti, Piëmont|Italië|rood|Barbera
Dolcetto d'Alba|Alba, Piëmont|Italië|rood|Dolcetto
Gattinara|Gattinara, Piëmont|Italië|rood|Nebbiolo
Ghemme|Ghemme, Piëmont|Italië|rood|Nebbiolo
Gavi|Gavi, Piëmont|Italië|wit|Cortese
Moscato d'Asti|Asti, Piëmont|Italië|mousserend|Moscato
Asti|Asti, Piëmont|Italië||
Piemonte|Piëmont|Italië||
Amarone della Valpolicella|Valpolicella, Veneto|Italië|rood|Corvina, Rondinella
Valpolicella Ripasso|Valpolicella, Veneto|Italië|rood|Corvina, Rondinella
Valpolicella|Valpolicella, Veneto|Italië|rood|Corvina, Rondinella
Recioto della Valpolicella|Valpolicella, Veneto|Italië|dessert|Corvina
Soave|Soave, Veneto|Italië|wit|Garganega
Bardolino|Bardolino, Veneto|Italië|rood|Corvina
Lugana|Lugana|Italië|wit|Turbiana
Prosecco Superiore|Valdobbiadene, Veneto|Italië|mousserend|Glera
Valdobbiadene|Valdobbiadene, Veneto|Italië|mousserend|Glera
Prosecco|Prosecco, Veneto|Italië|mousserend|Glera
Franciacorta|Franciacorta, Lombardije|Italië|mousserend|Chardonnay, Pinot Noir
Trentodoc|Trentino|Italië|mousserend|Chardonnay
Alto Adige|Alto Adige|Italië||
Südtirol|Alto Adige|Italië||
Trentino|Trentino|Italië||
Friuli|Friuli|Italië||
Collio|Collio, Friuli|Italië|wit|
Lambrusco|Emilia-Romagna|Italië|mousserend|Lambrusco
Verdicchio|Marche|Italië|wit|Verdicchio
Rosso Conero|Conero, Marche|Italië|rood|Montepulciano
Montepulciano d'Abruzzo|Abruzzo|Italië|rood|Montepulciano
Trebbiano d'Abruzzo|Abruzzo|Italië|wit|Trebbiano
Abruzzo|Abruzzo|Italië||
Montefalco Sagrantino|Montefalco, Umbrië|Italië|rood|Sagrantino
Orvieto|Orvieto, Umbrië|Italië|wit|
Taurasi|Taurasi, Campanië|Italië|rood|Aglianico
Fiano di Avellino|Avellino, Campanië|Italië|wit|Fiano
Greco di Tufo|Tufo, Campanië|Italië|wit|Greco
Aglianico del Vulture|Vulture, Basilicata|Italië|rood|Aglianico
Primitivo di Manduria|Manduria, Puglia|Italië|rood|Primitivo
Salice Salentino|Salento, Puglia|Italië|rood|Negroamaro
Salento|Salento, Puglia|Italië||
Puglia|Puglia|Italië||
Cirò|Cirò, Calabrië|Italië|rood|Gaglioppo
Etna Rosso|Etna, Sicilië|Italië|rood|Nerello Mascalese
Etna Bianco|Etna, Sicilië|Italië|wit|Carricante
Etna|Etna, Sicilië|Italië||
Cerasuolo di Vittoria|Vittoria, Sicilië|Italië|rood|Nero d'Avola, Frappato
Marsala|Marsala, Sicilië|Italië|dessert|
Sicilia|Sicilië|Italië||
Cannonau di Sardegna|Sardinië|Italië|rood|Cannonau
Vermentino di Gallura|Gallura, Sardinië|Italië|wit|Vermentino
Vermentino di Sardegna|Sardinië|Italië|wit|Vermentino
Rioja|Rioja|Spanje|rood|Tempranillo
Ribera del Duero|Ribera del Duero|Spanje|rood|Tempranillo
Toro|Toro|Spanje|rood|Tinta de Toro
Priorat|Priorat|Spanje|rood|Garnacha, Cariñena
Montsant|Montsant|Spanje|rood|Garnacha, Cariñena
Penedès|Penedès|Spanje||
Cava|Cava|Spanje|mousserend|Macabeo, Xarel·lo, Parellada
Rías Baixas|Rías Baixas|Spanje|wit|Albariño
Rueda|Rueda|Spanje|wit|Verdejo
Bierzo|Bierzo|Spanje|rood|Mencía
Ribeira Sacra|Ribeira Sacra|Spanje|rood|Mencía
Navarra|Navarra|Spanje||
Jumilla|Jumilla|Spanje|rood|Monastrell
Yecla|Yecla|Spanje|rood|Monastrell
Calatayud|Calatayud|Spanje|rood|Garnacha
Campo de Borja|Campo de Borja|Spanje|rood|Garnacha
La Mancha|La Mancha|Spanje||
Valdepeñas|Valdepeñas|Spanje||
Jerez|Jerez|Spanje|dessert|Palomino
Sherry|Jerez|Spanje|dessert|Palomino
Douro|Douro|Portugal||
Porto|Douro|Portugal|dessert|Touriga Nacional, Tinta Roriz
Port Wine|Douro|Portugal|dessert|Touriga Nacional, Tinta Roriz
Vinho Verde|Vinho Verde|Portugal|wit|Alvarinho, Loureiro
Dão|Dão|Portugal||
Alentejo|Alentejo|Portugal||
Bairrada|Bairrada|Portugal||
Madeira|Madeira|Portugal|dessert|
Mosel|Mosel|Duitsland|wit|Riesling
Rheingau|Rheingau|Duitsland|wit|Riesling
Rheinhessen|Rheinhessen|Duitsland||
Pfalz|Pfalz|Duitsland||
Nahe|Nahe|Duitsland|wit|Riesling
Baden|Baden|Duitsland||
Franken|Franken|Duitsland|wit|Silvaner
Ahr|Ahr|Duitsland|rood|Spätburgunder
Wachau|Wachau|Oostenrijk|wit|Grüner Veltliner, Riesling
Kamptal|Kamptal|Oostenrijk|wit|Grüner Veltliner
Kremstal|Kremstal|Oostenrijk|wit|Grüner Veltliner
Burgenland|Burgenland|Oostenrijk||
Tokaji|Tokaj|Hongarije|dessert|Furmint
Napa Valley|Napa Valley, Californië|Verenigde Staten||
Sonoma|Sonoma, Californië|Verenigde Staten||
Paso Robles|Paso Robles, Californië|Verenigde Staten||
Willamette Valley|Willamette Valley, Oregon|Verenigde Staten|rood|Pinot Noir
California|Californië|Verenigde Staten||
Mendoza|Mendoza|Argentinië|rood|Malbec
Uco Valley|Uco Valley, Mendoza|Argentinië||
Salta|Salta|Argentinië||
Maipo|Maipo|Chili||
Colchagua|Colchagua|Chili||
Casablanca|Casablanca|Chili||
Stellenbosch|Stellenbosch|Zuid-Afrika||
Swartland|Swartland|Zuid-Afrika||
Franschhoek|Franschhoek|Zuid-Afrika||
Barossa Valley|Barossa Valley|Australië|rood|Shiraz
McLaren Vale|McLaren Vale|Australië|rood|Shiraz
Margaret River|Margaret River|Australië||
Yarra Valley|Yarra Valley|Australië||
Coonawarra|Coonawarra|Australië|rood|Cabernet Sauvignon
Marlborough|Marlborough|Nieuw-Zeeland|wit|Sauvignon Blanc
Central Otago|Central Otago|Nieuw-Zeeland|rood|Pinot Noir
Hawke's Bay|Hawke's Bay|Nieuw-Zeeland||
Haspengouw|Haspengouw|België||
Hageland|Hageland|België||
Heuvelland|Heuvelland|België||
Côtes de Sambre et Meuse|Sambre et Meuse|België||`
    .trim().split("\n").map(l => { const [name, region, country, color, grape] = l.split("|");
      return {name, key: nrm(name), words: " " + wordsOf(name).join(" ") + " ", region, country, color, grape, specific: region.includes(",")}; });

  const COUNTRY = [
    ["Frankrijk", ["produitdefrance", "productoffrance", "vindefrance", "appellationcontrolee", "appellationdorigineprotegee", "misenbouteilleauchateau", "misenbouteilleaudomaine"]],
    ["Italië", ["prodottoinitalia", "productofitaly", "italia", "italy", "denominazionediorigine", "imbottigliato"]],
    ["Spanje", ["productodeespana", "productofspain", "espana", "spain", "denominaciondeorigen"]],
    ["Portugal", ["produtodeportugal", "productofportugal", "portugal"]],
    ["Duitsland", ["deutschland", "productofgermany", "qualitatswein", "pradikatswein"]],
    ["Oostenrijk", ["osterreich", "austria", "productofaustria"]],
    ["België", ["belgie", "belgique", "productofbelgium"]],
    ["Verenigde Staten", ["productofusa", "californiawine"]],
    ["Argentinië", ["argentina", "productofargentina"]],
    ["Chili", ["productofchile", "chile"]],
    ["Zuid-Afrika", ["southafrica", "wineofsouthafrica"]],
    ["Australië", ["productofaustralia", "australia"]],
    ["Nieuw-Zeeland", ["newzealand", "productofnewzealand"]],
    ["Hongarije", ["hungary", "magyar"]]
  ];
  const COLOR = [
    ["mousserend", ["champagne", "cremant", "cava", "prosecco", "spumante", "sekt", "methodetraditionnelle", "metodoclassico", "brutnature", "extrabrut", "brut", "petnat", "frizzante"]],
    ["dessert", ["sauternes", "portwine", "vintageport", "tawny", "lbv", "lateharvest", "vendangestardives", "passito", "auslese", "beerenauslese", "eiswein", "vindoux", "vinliquoreux", "oloroso", "pedroximenez", "moscatel"]],
    ["rose", ["rose", "rosato", "rosado", "blush", "cerasuolo"]],
    ["wit", ["blanc", "bianco", "blanco", "branco", "white", "weiss", "weisswein"]],
    ["rood", ["rouge", "rosso", "tinto", "red", "rotwein"]]
  ];
  const GRAPES = ["Cabernet Sauvignon", "Cabernet Franc", "Merlot", "Pinot Noir", "Syrah", "Shiraz", "Grenache", "Garnacha", "Mourvèdre", "Monastrell", "Carignan", "Cinsault", "Malbec", "Tempranillo", "Sangiovese", "Nebbiolo", "Barbera", "Dolcetto", "Primitivo", "Zinfandel", "Negroamaro", "Nero d'Avola", "Aglianico", "Montepulciano", "Corvina", "Gamay", "Pinotage", "Touriga Nacional", "Mencía", "Tannat", "Petit Verdot", "Carménère", "Blaufränkisch", "Zweigelt", "Spätburgunder", "Chardonnay", "Sauvignon Blanc", "Sémillon", "Chenin Blanc", "Riesling", "Gewürztraminer", "Pinot Gris", "Pinot Grigio", "Pinot Blanc", "Viognier", "Marsanne", "Roussanne", "Grüner Veltliner", "Albariño", "Alvarinho", "Verdejo", "Godello", "Vermentino", "Fiano", "Greco", "Garganega", "Glera", "Trebbiano", "Verdicchio", "Muscat", "Moscato", "Furmint", "Melon de Bourgogne", "Aligoté", "Silvaner", "Müller-Thurgau", "Picpoul", "Arneis", "Cortese", "Friulano", "Ribolla Gialla", "Assyrtiko", "Torrontés", "Viura", "Macabeo"]
    .map(g => ({g, key: nrm(g)})).sort((a, b) => b.key.length - a.key.length);
  const PRODUCER = /\b(ch[aâ]teau|domaine|dom\.|tenuta|bodegas?|weingut|cantina|cantine|maison|clos|quinta|fattoria|azienda|agricola|cave|caves|vignobles?|castello|podere|marchesi|estate|winery|famille|herdade|ca'|cascina)\b/i;
  const NOISE = /(appellation|contr[oô]l[ée]e|prot[ée]g[ée]e|mis en bouteille|imbottigliat|embotellad|bottled|produit|product|prodotto|contains|contient|sulfites|solfiti|sulfitos|\d+\s*(ml|cl|l)\b|\d+([.,]\d)?\s*%\s*(vol|alc)|\bvol\b|www\.|\.com|lot\b|\bl\d{3,}|denominazione|denominaci|origine|origen|garantita|vin de france|grand vin de|recoltant|r[ée]colte|harvest|annata|cosecha)/i;

  function lev(a, b){
    const m = a.length, n = b.length; if(!m) return n; if(!n) return m;
    let prev = Array.from({length: n + 1}, (_, j) => j), cur = new Array(n + 1);
    for(let i = 1; i <= m; i++){
      cur[0] = i;
      for(let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  // Is `key` somewhere in `text`, allowing a few OCR mistakes on longer words?
  function fuzzyIn(text, key){
    if(text.includes(key)) return 0;
    const tol = key.length >= 12 ? 2 : key.length >= 7 ? 1 : 0;
    if(!tol) return -1;
    let best = 99;
    for(let i = 0; i + key.length - tol <= text.length; i++){
      for(let L = key.length - tol; L <= key.length + tol; L++){
        if(i + L > text.length) break;
        const d = lev(text.slice(i, i + L), key); if(d < best) best = d;
        if(best === 0) return 0;
      }
    }
    return best <= tol ? best : -1;
  }

  function parse(lines){
    const all = lines.map(l => l.text).join("\n");
    const flat = nrm(all);
    const out = {};
    // vintage: 4-digit year that is plausible, ignoring "since 1890"-style founding years
    const years = [...all.matchAll(/(?<![\d])((?:19[5-9]|20[0-4])\d)(?![\d])/g)]
      .filter(m => +m[1] <= YEAR && !/(since|depuis|dal|desde|seit|founded|fond[ée]e?|est\.?)\s*$/i.test(all.slice(Math.max(0, m.index - 12), m.index)))
      .map(m => m[1]);
    if(years.length) out.vintage = years.sort((a, b) => years.filter(y => y === b).length - years.filter(y => y === a).length || b - a)[0];
    // appellation: a village or sub-region beats the broad region ("Margaux" over "Grand vin de Bordeaux"),
    // then the longest name wins ("Chianti Classico" over "Chianti"). Short names must be whole words.
    const wtext = " " + wordsOf(all).join(" ") + " ";
    let app = null;
    const rank = (a, d) => (a.specific ? 100 : 0) + a.key.length - d;
    for(const a of APP){
      const d = a.key.length < 7 ? (wtext.includes(a.words) ? 0 : -1) : fuzzyIn(flat, a.key);
      if(d >= 0 && (!app || rank(a, d) > rank(app.a, app.d))) app = {a, d};
    }
    if(app){ out.region = app.a.region; out.country = app.a.country; if(app.a.color) out.color = app.a.color; if(app.a.grape) out.grape = app.a.grape; out.appellation = app.a.name; }
    if(!out.country){ for(const [c, keys] of COUNTRY) if(keys.some(k => flat.includes(k))){ out.country = c; break; } }
    // colour words on the label beat the appellation's usual colour (e.g. "Sancerre Rouge")
    const words = all.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(Boolean);
    const wordset = new Set(words), joined = words.join("");
    for(const [c, keys] of COLOR){
      if(keys.some(k => k.length > 6 ? joined.includes(k) : wordset.has(k))){ if(!(c === "mousserend" && out.color === "dessert")) out.color = c; break; }
    }
    // grapes named on the label beat the appellation's usual grapes
    const found = []; let rest = flat;
    for(const {g, key} of GRAPES) if(rest.includes(key)){ found.push(g); rest = rest.split(key).join("|"); }
    if(found.length) out.grape = found.slice(0, 4).join(", ");
    // producer and name from the readable lines, biggest text first
    const plain = new Set([...GRAPES.map(g => g.key), ...COLOR.flatMap(c => c[1]), "rosso", "rouge", "tinto", "blanc", "bianco"]);
    const isPlain = t => wordsOf(t).every(w => plain.has(w) || w.length < 3) || GRAPES.some(g => g.key === nrm(t));
    const cands = lines.filter(l => l.useful && !NOISE.test(l.text) && !/^\s*\d{4}\s*$/.test(l.text) && !isPlain(l.text));
    const pi = cands.findIndex(l => PRODUCER.test(l.text));
    let prod = pi >= 0 ? cands[pi] : null;
    // "CHÂTEAU LA" + "TOUR" printed on two lines: join them
    if(prod && /\b(la|le|les|de|du|des|di|del|della|dei|da|do|dos|das|von|van|of|san|santa|saint|st)\s*$/i.test(prod.text) && cands[pi + 1])
      prod = {...prod, text: prod.text + " " + cands[pi + 1].text, joined: cands[pi + 1]};
    if(prod) out.producer = tidy(prod.text);
    const big = [...cands].sort((a, b) => b.h - a.h);
    const nameLine = big.find(l => l !== prod && (!prod || l !== prod.joined && l !== cands[pi]) && nrm(l.text).length >= 3) || prod;
    if(nameLine) out.name = tidy(nameLine.text);
    if(!out.name && app) out.name = app.a.name;
    return out;
  }
  // "CHATEAU MARGAUX" → "Château Margaux"; keep mixed case as printed
  function tidy(s){
    s = s.replace(/\s+/g, " ").replace(/^[^\p{L}\d]+|[^\p{L}\d.)']+$/gu, "").trim();
    if(s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s\-'’(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
      .replace(/\b(De|Du|Des|La|Le|Les|Di|Del|Della|Dei|Da|Of|And|Et|E|Y|Am|Im|Von|Van)\b/g, (w, _, i) => i ? w.toLowerCase() : w)
      .replace(/\bChateau\b/g, "Château");
    return s;
  }

  // ---- image + OCR -------------------------------------------------------
  function prepare(file){
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(2, 1800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        const x = c.getContext("2d", {willReadFrequently: true}); x.drawImage(img, 0, 0, c.width, c.height);
        // grayscale + contrast stretch helps on cream paper and gold print
        const d = x.getImageData(0, 0, c.width, c.height), p = d.data; let lo = 255, hi = 0;
        for(let i = 0; i < p.length; i += 4){ const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = g; if(g < lo) lo = g; if(g > hi) hi = g; }
        const k = 255 / Math.max(1, hi - lo);
        for(let i = 0; i < p.length; i += 4){ const g = (p[i] - lo) * k; p[i] = p[i + 1] = p[i + 2] = g; }
        x.putImageData(d, 0, 0); URL.revokeObjectURL(url); res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image")); };
      img.src = url;
    });
  }

  let libP = null, workerP = null, progressCb = null;
  function loadLib(){
    return libP ||= new Promise((res, rej) => {
      if(window.Tesseract) return res();
      const s = document.createElement("script"); s.src = BASE + "tesseract.min.js";
      s.onload = () => window.Tesseract ? res() : rej(new Error("nolib"));
      s.onerror = () => { libP = null; rej(new Error("nolib")); };
      document.head.appendChild(s);
    });
  }
  function getWorker(){
    return workerP ||= loadLib().then(() => Tesseract.createWorker(["fra", "eng"], 1, {
      workerPath: BASE + "worker.min.js", corePath: BASE + "core", langPath: BASE + "lang",
      workerBlobURL: false, gzip: true,
      logger: m => { if(progressCb && m && typeof m.progress === "number") progressCb(m.status || "", m.progress); }
    })).then(async w => { await w.setParameters({tessedit_pageseg_mode: "3", preserve_interword_spaces: "1"}); return w; })
      .catch(e => { workerP = null; throw e; });
  }

  async function read(file, onProgress){
    progressCb = onProgress || null;
    const [canvas, worker] = await Promise.all([prepare(file), getWorker()]);
    const {data} = await worker.recognize(canvas, {}, {blocks: true, text: true});
    progressCb = null;
    const lines = [];
    for(const b of data.blocks || []) for(const p of b.paragraphs || []) for(const l of p.lines || []){
      const text = (l.text || "").replace(/\s+/g, " ").trim();
      if(!text) continue;
      const letters = (text.match(/\p{L}/gu) || []).length;
      const useful = l.confidence >= 45 && letters >= 3 && letters / text.replace(/\s/g, "").length >= 0.6;
      lines.push({text, h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, conf: l.confidence, useful});
    }
    return {lines, fields: parse(lines), text: data.text || ""};
  }

  window.mwOcr = {read, parse, warm: () => getWorker().catch(() => {})};
})();

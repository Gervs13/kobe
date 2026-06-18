/**
 * Veille médias automatique — Make Your Move / Living Sisu / Showdown
 * ------------------------------------------------------------------
 * Ce script tourne CHAQUE VENDREDI et ajoute automatiquement dans le
 * Google Sheet tous les nouveaux articles qui mentionnent les marques
 * surveillées. La source est Google News (gratuit, aucune clé d'API).
 *
 * INSTALLATION (une seule fois) :
 *  1. Ouvrir le Google Sheet de veille.
 *  2. Menu  Extensions ▸ Apps Script.
 *  3. Coller ce fichier, sauvegarder.
 *  4. Lancer la fonction « installerDeclencheurHebdo » une fois
 *     (autoriser l'accès quand Google le demande).
 *  5. C'est tout : le script s'exécutera tous les vendredis 8h.
 *
 * Pour un test immédiat, lancer la fonction « lancerVeille ».
 */

// === CONFIGURATION ===========================================================

// Mots-clés/requêtes surveillés. On garde « Showdown » collé à « Make Your Move »
// pour éviter le bruit (Showdown seul est trop générique).
var REQUETES = [
  '"Make Your Move Showdown"',
  '"Make Your Move" hockey',
  '"Living Sisu"',
  'LSHL hockey',
  'Zachary Fucale Living Sisu'
];

// Marché Google News : Canada, français. (utiliser en-CA pour l'anglais)
var GNEWS_PARAMS = 'hl=fr-CA&gl=CA&ceid=CA:fr';

var NOM_FEUILLE = 'Articles'; // onglet où écrire

// En-têtes (doivent rester alignées avec ecrireLigne)
var ENTETES = [
  'Date repérage', 'Marque / Mot-clé', "Titre de l'article", 'Média / Source',
  'URL', 'Date publication', 'Type de média', 'Portée estimée (impressions)', 'Notes'
];

// === POINT D'ENTRÉE HEBDOMADAIRE =============================================

function lancerVeille() {
  var feuille = obtenirFeuille_();
  var urlsExistantes = chargerUrlsExistantes_(feuille);
  var aujourdHui = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var nbAjout = 0;

  REQUETES.forEach(function (requete) {
    var articles = chercherGoogleNews_(requete);
    articles.forEach(function (a) {
      var cleUrl = normaliserUrl_(a.url);
      if (cleUrl && !urlsExistantes[cleUrl]) {
        urlsExistantes[cleUrl] = true;
        feuille.appendRow([
          aujourdHui,        // Date repérage
          requete.replace(/"/g, ''), // Marque / Mot-clé
          a.titre,           // Titre
          a.source,          // Média / Source
          a.url,             // URL
          a.datePub,         // Date publication
          'Article web',     // Type de média
          '',                // Portée estimée (impressions) — à remplir manuellement
          ''                 // Notes
        ]);
        nbAjout++;
      }
    });
    Utilities.sleep(1500); // courtoisie envers Google News
  });

  feuille.getRange(1, 1, 1, ENTETES.length).setFontWeight('bold');
  feuille.autoResizeColumns(1, ENTETES.length);
  Logger.log(nbAjout + ' nouvel(s) article(s) ajouté(s).');
  return nbAjout;
}

// === RECHERCHE GOOGLE NEWS (RSS) =============================================

function chercherGoogleNews_(requete) {
  var url = 'https://news.google.com/rss/search?q=' +
            encodeURIComponent(requete) + '&' + GNEWS_PARAMS;
  var resultats = [];
  try {
    var xml = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
    var doc = XmlService.parse(xml);
    var items = doc.getRootElement().getChild('channel').getChildren('item');
    items.forEach(function (item) {
      var titreBrut = texte_(item, 'title');
      var source = item.getChild('source') ? item.getChild('source').getText() : '';
      // Le titre Google News finit souvent par « - Nom du média »
      var titre = titreBrut;
      if (!source && titreBrut.indexOf(' - ') > -1) {
        var parts = titreBrut.split(' - ');
        source = parts.pop();
        titre = parts.join(' - ');
      }
      var pubDate = texte_(item, 'pubDate');
      var datePub = pubDate ? Utilities.formatDate(new Date(pubDate),
                    Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
      resultats.push({
        titre: titre,
        url: texte_(item, 'link'),
        source: source,
        datePub: datePub
      });
    });
  } catch (e) {
    Logger.log('Erreur pour « ' + requete + ' » : ' + e);
  }
  return resultats;
}

// === UTILITAIRES =============================================================

function obtenirFeuille_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = ss.getSheetByName(NOM_FEUILLE);
  if (!feuille) {
    feuille = ss.getSheets()[0]; // sinon on prend le premier onglet
    feuille.setName(NOM_FEUILLE);
  }
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(ENTETES);
  }
  return feuille;
}

function chargerUrlsExistantes_(feuille) {
  var map = {};
  var dernLigne = feuille.getLastRow();
  if (dernLigne < 2) return map;
  var colUrl = ENTETES.indexOf('URL') + 1;
  var valeurs = feuille.getRange(2, colUrl, dernLigne - 1, 1).getValues();
  valeurs.forEach(function (v) {
    var c = normaliserUrl_(v[0]);
    if (c) map[c] = true;
  });
  return map;
}

function normaliserUrl_(url) {
  if (!url) return '';
  return String(url).trim().toLowerCase().replace(/\/$/, '').split('?')[0];
}

function texte_(item, nom) {
  var c = item.getChild(nom);
  return c ? c.getText() : '';
}

// === DÉCLENCHEUR HEBDOMADAIRE ================================================

function installerDeclencheurHebdo() {
  // Supprime les anciens déclencheurs pour éviter les doublons
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lancerVeille') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lancerVeille')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(8)
    .create();
  Logger.log('Déclencheur installé : tous les vendredis vers 8h.');
}

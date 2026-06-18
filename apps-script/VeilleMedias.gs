/**
 * Veille médias automatique — Make Your Move (MYM) / Living Sisu / Showdown
 * =========================================================================
 * Ce script construit un rapport multi-onglets dans le Google Sheet et le
 * met à jour CHAQUE VENDREDI :
 *
 *   Onglet « Rapport complet »  -> tout (En ligne + Réseaux sociaux)
 *   Onglet « En ligne »         -> articles de presse/web (Google News, gratuit)
 *   Onglet « Réseaux sociaux »  -> posts des comptes MYM (IG, FB, LinkedIn, X)
 *   Onglet « Légende »          -> explications
 *
 * INSTALLATION (une seule fois) :
 *   1. Ouvrir le Google Sheet, menu Extensions > Apps Script.
 *   2. Coller ce fichier, sauvegarder.
 *   3. Lancer « construireRapport » une fois  -> crée les onglets + données presse.
 *   4. (Réseaux sociaux) Voir la section CONFIG RÉSEAUX SOCIAUX plus bas pour
 *      ajouter les jetons d'accès des comptes MYM, puis lancer « majReseauxSociaux ».
 *   5. Lancer « installerDeclencheurHebdo »  -> exécution auto chaque vendredi 8h.
 */

// ============================================================================
//  CONFIG — PRESSE / WEB
// ============================================================================

var REQUETES = [
  '"Make Your Move Showdown"',
  '"Make Your Move" hockey',
  '"Living Sisu"',
  'LSHL hockey',
  'Zachary Fucale Living Sisu'
];

var GNEWS_PARAMS = 'hl=fr-CA&gl=CA&ceid=CA:fr';

// Niveau de portée presse estimé selon le média (qualitatif, pas des impressions exactes)
var PORTEE_MEDIA = {
  'lapresse.ca': 'Tres elevee', 'sports.yahoo.com': 'Tres elevee', 'rds.ca': 'Tres elevee',
  'tvasports.ca': 'Tres elevee', 'journaldemontreal.com': 'Tres elevee',
  'thehockeynews.com': 'Elevee', 'chl.ca': 'Elevee', 'hockeycanada.ca': 'Elevee',
  'nhl.com': 'Tres elevee', 'sportsnet.ca': 'Tres elevee',
  'hockeylemagazine.com': 'Moyenne', 'danslescoulisses.com': 'Moyenne',
  'lapochebleue.com': 'Moyenne', 'habsolumentfan.com': 'Moyenne',
  'dose.ca': 'Moyenne', 'yardbarker.com': 'Moyenne', 'thehockeywriters.com': 'Moyenne',
  'oursportscentral.com': 'Faible', 'livebarn.com': 'Faible'
};

// ============================================================================
//  CONFIG — RÉSEAUX SOCIAUX (comptes MYM uniquement, + collabs ex. MYM x RDS)
// ============================================================================
//
//  Les impressions EXACTES viennent des API officielles. Il faut fournir, une
//  seule fois, les identifiants + jetons d'accès dans les "Script Properties"
//  (Projet Apps Script > Paramètres du projet > Propriétés du script), avec ces
//  clés. Tant qu'elles sont vides, l'onglet social affiche un rappel.
//
//   META_PAGE_ID        = ID de la Page Facebook MYM (Make Your Move)
//   META_IG_USER_ID     = ID du compte Instagram Business MYM
//   META_ACCESS_TOKEN   = jeton long-lived Meta (perm: pages_read_engagement,
//                         instagram_basic, instagram_manage_insights, read_insights)
//   LINKEDIN_ORG_URN    = urn:li:organization:XXXX de la page MYM
//   LINKEDIN_TOKEN      = jeton OAuth LinkedIn (r_organization_social, rw_organization_admin)
//   X_USER_ID           = ID numérique du compte X/Twitter MYM
//   X_BEARER_TOKEN      = Bearer token X API v2 (tier payant requis pour les impressions)
//
//  -> Aide pour obtenir ces jetons : voir README du dépôt.

// ============================================================================
//  ONGLETS / EN-TÊTES
// ============================================================================

var T_COMPLET = 'Rapport complet';
var T_ENLIGNE = 'En ligne';
var T_SOCIAL  = 'Reseaux sociaux';
var T_LEGENDE = 'Legende';

var H_COMPLET = ['Canal','Date reperage','Marque / Compte','Plateforme / Media','Titre / Description','Lien','Date publication','Impressions / Portee','Notes'];
var H_ENLIGNE = ['Date reperage','Marque / Mot-cle','Titre de l\'article','Media / Source','URL','Date publication','Type de media','Portee presse (estimee)','Notes'];
var H_SOCIAL  = ['Date reperage','Compte MYM','Plateforme','Date publication','Description du post','Lien','Impressions','Portee (reach)','J\'aime','Commentaires','Partages','Notes'];

// ============================================================================
//  POINT D'ENTRÉE GLOBAL (déclenché chaque vendredi)
// ============================================================================

function majHebdomadaire() {
  construireRapport();      // s'assure que les onglets existent + seed presse
  majPresse();              // Google News
  majReseauxSociaux();      // IG / FB / LinkedIn / X (si jetons fournis)
}

// ============================================================================
//  CONSTRUCTION DES ONGLETS
// ============================================================================

function construireRapport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  feuilleAvecEntetes_(ss, T_COMPLET, H_COMPLET);
  var enl = feuilleAvecEntetes_(ss, T_ENLIGNE, H_ENLIGNE);
  feuilleAvecEntetes_(ss, T_SOCIAL, H_SOCIAL);
  construireLegende_(ss);

  // Seed initial de la presse déjà trouvée (une seule fois, si l'onglet est vide)
  if (enl.getLastRow() < 2) {
    PRESS_SEED.forEach(function (r) { ecrirePresse_(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]); });
  }
  // Rappel dans l'onglet social s'il est vide
  var soc = ss.getSheetByName(T_SOCIAL);
  if (soc.getLastRow() < 2 && !jetonsSociauxPresents_()) {
    soc.getRange(2, 1).setValue('A CONNECTER — ajoutez les jetons des comptes MYM (voir CONFIG en haut du script), puis lancez majReseauxSociaux.')
       .setFontColor('#B00000').setFontStyle('italic');
  }
  ss.toast('Rapport construit / verifie.', 'Veille MYM', 5);
}

// ============================================================================
//  PRESSE / WEB  (Google News)
// ============================================================================

function majPresse() {
  var urls = urlsExistantes_(T_ENLIGNE, H_ENLIGNE.indexOf('URL') + 1);
  var auj = dateStr_(new Date());
  REQUETES.forEach(function (q) {
    chercherGoogleNews_(q).forEach(function (a) {
      var cle = normUrl_(a.url);
      if (cle && !urls[cle]) {
        urls[cle] = true;
        ecrirePresse_(auj, q.replace(/"/g, ''), a.titre, a.source, a.url, a.datePub, 'Article web', porteePour_(a.url, a.source));
      }
    });
    Utilities.sleep(1200);
  });
}

function chercherGoogleNews_(requete) {
  var url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(requete) + '&' + GNEWS_PARAMS;
  var out = [];
  try {
    var xml = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
    var items = XmlService.parse(xml).getRootElement().getChild('channel').getChildren('item');
    items.forEach(function (item) {
      var titre = txt_(item, 'title'), source = item.getChild('source') ? item.getChild('source').getText() : '';
      if (!source && titre.indexOf(' - ') > -1) { var p = titre.split(' - '); source = p.pop(); titre = p.join(' - '); }
      var pd = txt_(item, 'pubDate');
      out.push({ titre: titre, url: txt_(item, 'link'), source: source,
                 datePub: pd ? dateStr_(new Date(pd)) : '' });
    });
  } catch (e) { Logger.log('GNews "' + requete + '": ' + e); }
  return out;
}

function porteePour_(url, source) {
  var u = (url || '').toLowerCase();
  for (var dom in PORTEE_MEDIA) { if (u.indexOf(dom) > -1) return PORTEE_MEDIA[dom]; }
  return 'A determiner';
}

function ecrirePresse_(dateRep, marque, titre, media, url, datePub, type, portee) {
  ligne_(T_ENLIGNE, [dateRep, marque, titre, media, url, datePub, type, portee, '']);
  ligne_(T_COMPLET, ['En ligne', dateRep, marque, media, titre, url, datePub, portee, '']);
}

// ============================================================================
//  RÉSEAUX SOCIAUX  (comptes MYM)
// ============================================================================

function majReseauxSociaux() {
  if (!jetonsSociauxPresents_()) { Logger.log('Aucun jeton social configure.'); return; }
  var liens = urlsExistantes_(T_SOCIAL, H_SOCIAL.indexOf('Lien') + 1);
  var auj = dateStr_(new Date());
  [pullInstagram_, pullFacebook_, pullLinkedIn_, pullX_].forEach(function (fn) {
    try {
      fn(auj).forEach(function (p) {
        var cle = normUrl_(p.lien) || (p.plateforme + '|' + p.datePub + '|' + p.desc).toLowerCase();
        if (!liens[cle]) {
          liens[cle] = true;
          ligne_(T_SOCIAL, [auj, p.compte, p.plateforme, p.datePub, p.desc, p.lien, p.impressions, p.reach, p.likes, p.comments, p.shares, p.notes || '']);
          ligne_(T_COMPLET, ['Reseau social', auj, p.compte, p.plateforme, p.desc, p.lien, p.datePub, p.impressions, p.notes || '']);
        }
      });
    } catch (e) { Logger.log('Social: ' + e); }
  });
}

var P = PropertiesService.getScriptProperties();
function jetonsSociauxPresents_() {
  return !!(P.getProperty('META_ACCESS_TOKEN') || P.getProperty('LINKEDIN_TOKEN') || P.getProperty('X_BEARER_TOKEN'));
}

// --- Instagram (Make Your Move) via Meta Graph API ---
function pullInstagram_(auj) {
  var ig = P.getProperty('META_IG_USER_ID'), tok = P.getProperty('META_ACCESS_TOKEN');
  if (!ig || !tok) return [];
  var url = 'https://graph.facebook.com/v20.0/' + ig + '/media?fields=id,caption,permalink,timestamp,like_count,comments_count,insights.metric(impressions,reach)&limit=25&access_token=' + tok;
  var data = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  return (data.data || []).map(function (m) {
    var imp = '', reach = '';
    if (m.insights && m.insights.data) m.insights.data.forEach(function (i) {
      if (i.name === 'impressions') imp = i.values[0].value;
      if (i.name === 'reach') reach = i.values[0].value;
    });
    return { compte: 'MYM (Instagram)', plateforme: 'Instagram', datePub: (m.timestamp || '').substring(0, 10),
             desc: (m.caption || '').substring(0, 200), lien: m.permalink || '', impressions: imp, reach: reach,
             likes: m.like_count || '', comments: m.comments_count || '', shares: '' };
  });
}

// --- Facebook Page (Make Your Move) ---
function pullFacebook_(auj) {
  var pg = P.getProperty('META_PAGE_ID'), tok = P.getProperty('META_ACCESS_TOKEN');
  if (!pg || !tok) return [];
  var url = 'https://graph.facebook.com/v20.0/' + pg + '/posts?fields=id,message,permalink_url,created_time,likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_impressions_unique)&limit=25&access_token=' + tok;
  var data = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  return (data.data || []).map(function (m) {
    var imp = '', reach = '';
    if (m.insights && m.insights.data) m.insights.data.forEach(function (i) {
      if (i.name === 'post_impressions') imp = i.values[0].value;
      if (i.name === 'post_impressions_unique') reach = i.values[0].value;
    });
    return { compte: 'MYM (Facebook)', plateforme: 'Facebook', datePub: (m.created_time || '').substring(0, 10),
             desc: (m.message || '').substring(0, 200), lien: m.permalink_url || '', impressions: imp, reach: reach,
             likes: m.likes && m.likes.summary ? m.likes.summary.total_count : '',
             comments: m.comments && m.comments.summary ? m.comments.summary.total_count : '',
             shares: m.shares ? m.shares.count : '' };
  });
}

// --- LinkedIn (page MYM) ---
function pullLinkedIn_(auj) {
  var org = P.getProperty('LINKEDIN_ORG_URN'), tok = P.getProperty('LINKEDIN_TOKEN');
  if (!org || !tok) return [];
  var url = 'https://api.linkedin.com/rest/posts?author=' + encodeURIComponent(org) + '&q=author&count=20&sortBy=LAST_MODIFIED';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok, 'LinkedIn-Version': '202405', 'X-Restli-Protocol-Version': '2.0.0' } });
  var data = JSON.parse(res.getContentText());
  return (data.elements || []).map(function (m) {
    return { compte: 'MYM (LinkedIn)', plateforme: 'LinkedIn', datePub: '',
             desc: ((m.commentary || '') + '').substring(0, 200), lien: m.id || '', impressions: '', reach: '',
             likes: '', comments: '', shares: '', notes: 'Impressions via /organizationalEntityShareStatistics' };
  });
}

// --- X / Twitter (compte MYM) ---
function pullX_(auj) {
  var uid = P.getProperty('X_USER_ID'), tok = P.getProperty('X_BEARER_TOKEN');
  if (!uid || !tok) return [];
  var url = 'https://api.twitter.com/2/users/' + uid + '/tweets?max_results=25&tweet.fields=created_at,public_metrics,non_public_metrics';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok } });
  var data = JSON.parse(res.getContentText());
  return (data.data || []).map(function (m) {
    var pm = m.public_metrics || {}, np = m.non_public_metrics || {};
    return { compte: 'MYM (X/Twitter)', plateforme: 'X (Twitter)', datePub: (m.created_at || '').substring(0, 10),
             desc: (m.text || '').substring(0, 200), lien: 'https://x.com/i/web/status/' + m.id,
             impressions: np.impression_count || pm.impression_count || '', reach: '',
             likes: pm.like_count || '', comments: pm.reply_count || '', shares: pm.retweet_count || '' };
  });
}

// ============================================================================
//  LÉGENDE
// ============================================================================

function construireLegende_(ss) {
  var s = ss.getSheetByName(T_LEGENDE);
  if (s) return;
  s = ss.insertSheet(T_LEGENDE);
  s.getRange('A1:B1').setValues([['Element', 'Explication']]).setFontWeight('bold');
  s.getRange('A2:B6').setValues([
    ['Portee presse (estimee)', 'Niveau qualitatif selon la taille du media (Tres elevee/Elevee/Moyenne/Faible). PAS un nombre d\'impressions exact.'],
    ['Impressions (reseaux sociaux)', 'Chiffres EXACTS via les API officielles (Meta/IG/FB, LinkedIn, X) une fois les jetons MYM ajoutes.'],
    ['Comptes suivis (social)', 'Make Your Move (MYM) uniquement, + collaborations (ex. MYM x RDS). Pas les autres comptes.'],
    ['Mise a jour', 'Automatique chaque vendredi 8h (presse via Google News; social via API).'],
    ['Mots-cles presse', 'Make Your Move Showdown, Make Your Move (hockey), Living Sisu, LSHL, Zachary Fucale.']
  ]);
  s.setColumnWidth(1, 230); s.setColumnWidth(2, 640);
  s.getRange('B2:B6').setWrap(true);
}

// ============================================================================
//  UTILITAIRES
// ============================================================================

function feuilleAvecEntetes_(ss, nom, entetes) {
  var s = ss.getSheetByName(nom);
  if (!s) {
    // réutilise la 1re feuille par défaut si elle est vide/sans nom utile
    var prem = ss.getSheets()[0];
    if (ss.getSheets().length === 1 && prem.getLastRow() === 0) { prem.setName(nom); s = prem; }
    else s = ss.insertSheet(nom);
  }
  if (s.getLastRow() === 0) {
    s.appendRow(entetes);
    s.getRange(1, 1, 1, entetes.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    s.setFrozenRows(1);
  }
  return s;
}

function ligne_(nom, valeurs) { SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom).appendRow(valeurs); }

function urlsExistantes_(nom, colIndex) {
  var map = {}, s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom);
  if (!s || s.getLastRow() < 2) return map;
  s.getRange(2, colIndex, s.getLastRow() - 1, 1).getValues().forEach(function (v) {
    var c = normUrl_(v[0]); if (c) map[c] = true;
  });
  return map;
}

function normUrl_(u) { return u ? String(u).trim().toLowerCase().replace(/\/$/, '').split('?')[0] : ''; }
function txt_(item, n) { var c = item.getChild(n); return c ? c.getText() : ''; }
function dateStr_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function installerDeclencheurHebdo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'majHebdomadaire') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('majHebdomadaire').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Declencheur installe: vendredis ~8h.', 'Veille MYM', 5);
}

// ============================================================================
//  DONNÉES PRESSE INITIALES (repérées le 2026-06-18)
//  [dateRep, marque, titre, media, url, datePub, type, portee]
// ============================================================================

var PRESS_SEED = [
 ['2026-06-18','Make Your Move Showdown','La fievre Demidov s\'empare de Boisbriand','La Presse','https://www.lapresse.ca/sports/hockey/2025-07-13/confrontation-de-tirs-de-barrage/la-fievre-demidov-s-empare-de-boisbriand.php','2025-07-13','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','Canadiens\' Prospect To Appear At The Make Your Move Showdown','Yahoo Sports','https://sports.yahoo.com/articles/canadiens-prospect-appear-move-showdown-110029296.html','2025-07','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','Canadiens: Demidov Set To Take Part In Showdown','Yahoo Sports','https://sports.yahoo.com/article/canadiens-demidov-set-part-showdown-120002209.html','2025-07','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','Canadiens: Demidov Gives A Good Show In Boisbriand','Yahoo Sports','https://sports.yahoo.com/article/canadiens-demidov-gives-good-show-110004744.html','2025-07','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','Canadiens: Demidov Gives A Good Show In Boisbriand','The Hockey News','https://thehockeynews.com/nhl/montreal-canadiens/latest-news/canadiens-demidov-gives-a-good-show-in-boisbriand','2025-07','Article web','Elevee'],
 ['2026-06-18','Make Your Move','Ivan Demidov stuns the gallery at the Make Your Move tournament','Dose.ca','https://dose.ca/2025/07/12/ivan-demidov-stuns-the-gallery-at-the-make-your-move-tournament/','2025-07-12','Article web','Moyenne'],
 ['2026-06-18','Make Your Move','Ivan Demidov donne tout un spectacle a l\'evenement Make Your Move','HabsolumentFan','https://www.habsolumentfan.com/canadiens/ivan-demidov-donne-tout-un-spectacle-a-levenement-make-your-move','2025-07','Article web','Moyenne'],
 ['2026-06-18','Make Your Move','Make Your Move : un 10e anniversaire (Blogue Jasmin Leroux)','Hockey Le Magazine','https://www.hockeylemagazine.com/fr/publication/nouvelle/blogue_jasmin_leroux_make_your_move_un_10e_anniversaire_pour_un_evenement_qui_a_toujours_ete_lincontournable_des_jeunes.html','2025','Blogue','Moyenne'],
 ['2026-06-18','Make Your Move','Make Your Move: more than 30 QMJHL players present','LHJMQ / CHL','https://chl.ca/lhjmq/en/article/make-your-move-more-than-30-qmjhl-players-present/','2025','Article web','Elevee'],
 ['2026-06-18','Make Your Move','Make Your Move: more than 30 QMJHL players present','OurSports Central','https://www.oursportscentral.com/services/releases/make-your-move-more-than-30-qmjhl-players-present/n-6253109','2025','Communique','Faible'],
 ['2026-06-18','Make Your Move','See Ivan Demidov on July 12 in Boisbriand','Yardbarker','https://www.yardbarker.com/nhl/articles/see_ivan_demidov_on_july_12_in_boisbriand/s1_17387_42352077','2025-07','Article web','Moyenne'],
 ['2026-06-18','Living Sisu Hockey League','Marie-Philip Poulin Leads Team Manmade To Living Sisu Title','The Hockey News','https://thehockeynews.com/womens/other-news/marie-philip-poulin-leads-team-manmade-to-living-sisu-title','2025-08','Article web','Elevee'],
 ['2026-06-18','Living Sisu Hockey League','Four Canadiens Players To Play In The LSHL As Teams Are Revealed','The Hockey News','https://thehockeynews.com/nhl/montreal-canadiens/latest-news/four-canadiens-players-to-play-in-the-lshl-as-teams-are-revealed','2025','Article web','Elevee'],
 ['2026-06-18','LSHL','La LSHL conclut sa saison 2025 et remet 20 000$ a la Fondation du cancer du pancreas','La Poche Bleue','https://lapochebleue.com/lshl-conclut-saison-2025-force-remet-20-000-fondation-cancer-pancreas-canada/','2025-08','Article web','Moyenne'],
 ['2026-06-18','LSHL','LSHL : Renobrio couronne champion','La Poche Bleue','https://lapochebleue.com/lshl-renobrio-couronne-champion/','2025-08','Article web','Moyenne'],
 ['2026-06-18','LSHL','LSHL: l\'endroit (a 13$) ou passer tes lundis et mardis soirs a Montreal','Dans les coulisses','https://www.danslescoulisses.com/lshl-lendroit-a-13-ou-passer-tes-lundis-et-mardis-soirs-a-montreal/','2025','Article web','Moyenne'],
 ['2026-06-18','Living Sisu Hockey League','Reportages - La Living Sisu Hockey League (LSHL)','Hockey Le Magazine','https://www.hockeylemagazine.com/fr/publication/nouvelle/reportages_la_living_sisu_hockey_league_lshl.html','','Reportage','Moyenne'],
 ['2026-06-18','Living Sisu Hockey League','Living Sisu Hockey League : une communaute, une ligue et beaucoup plus','Hockey Le Magazine','https://www.hockeylemagazine.com/en/publication/nouvelle/living_sisu_hockey_league_une_communaute_une_ligue_et_beaucoup_plus.html','','Reportage','Moyenne'],
 ['2026-06-18','Living Sisu','Keeping Game Ready: The Living Sisu Hockey League','LiveBarn','https://www.livebarn.com/blog/lshl','','Blogue','Faible'],
 ['2026-06-18','LSHL','Un nouveau souffle entre deux saisons','Hockey Canada','https://www.hockeycanada.ca/fr-ca/news/lshl-2022-wwc-feature','2022','Article web','Elevee'],
 ['2026-06-18','Zachary Fucale / Living Sisu','Zachary Fucale: Breaking News, Rumors & Highlights','Yardbarker','https://www.yardbarker.com/nhl/players/zachary_fucale/261445','','Agregateur','Moyenne'],
 ['2026-06-18','Zachary Fucale','Zachary Fucale: Goalie of the Future or Trade Bait?','The Hockey Writers','https://thehockeywriters.com/zachary-fucale-goalie-of-the-future-or-trade-bait/','','Article web','Moyenne'],
 ['2026-06-18','Make Your Move','Ivan Demidov a epate la galerie au tournoi Make Your Move','Dans les coulisses','https://www.danslescoulisses.com/ivan-demidov-a-epate-la-galerie-au-tournoi-make-your-move/','2025-07','Article web','Moyenne'],
 ['2026-06-18','Make Your Move','Ivan Demidov sera en action a Boisbriand ce samedi','Sports Addik','https://sportsaddik.com/canadiens/ivan-demidov-sera-en-action-a-boisbriand-ce-samedi/','2025-07','Article web','Moyenne'],
 ['2026-06-18','LSHL','Four Canadiens Players To Play In The LSHL','Yahoo Sports','https://sports.yahoo.com/article/four-canadiens-players-play-lshl-110002750.html','2025','Article web','Tres elevee'],
 ['2026-06-18','Living Sisu Hockey League','PWHL Stars Set To Star In Montreal\'s 3-on-3 Living Sisu Hockey League','The Hockey News','https://thehockeynews.com/womens/other-news/pwhl-stars-set-to-star-in-montreal-s-3-on-3-living-sisu-hockey-league','2025','Article web','Elevee'],
 ['2026-06-18','LSHL','Energized in the offseason (LSHL)','Hockey Canada','https://www.hockeycanada.ca/en-ca/news/lshl-2022-wwc-feature','2022','Article web','Elevee']
];

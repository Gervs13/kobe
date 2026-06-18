/**
 * Veille médias automatique — Make Your Move (MYM) / Living Sisu / Showdown
 * =========================================================================
 * Construit un rapport multi-onglets dans le Google Sheet et le met a jour
 * CHAQUE VENDREDI. Ne garde QUE les articles publies a partir de juin 2026.
 *
 *   Onglet « Rapport complet »  -> tout (En ligne + Reseaux sociaux)
 *   Onglet « En ligne »         -> articles presse/web (Google News, gratuit)
 *   Onglet « Reseaux sociaux »  -> posts des comptes MYM (IG, FB, LinkedIn, X)
 *   Onglet « Legende »          -> explications
 *
 * INSTALLATION (une fois) :
 *   1. Google Sheet > Extensions > Apps Script. Coller ce fichier. Sauvegarder.
 *   2. Lancer « construireRapport »      -> cree les onglets + articles de base.
 *   3. (Social) Ajouter les jetons MYM (voir CONFIG plus bas) + « majReseauxSociaux ».
 *   4. Lancer « installerDeclencheurHebdo » -> auto chaque vendredi 8h.
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

// On ne garde QUE les articles publies a partir de cette date (veille courante).
var DATE_MIN = '2026-06-01';

// Niveau de portee presse estime selon le media (qualitatif, pas des impressions exactes)
var PORTEE_MEDIA = {
  'lapresse.ca': 'Tres elevee', 'journaldequebec.com': 'Tres elevee',
  'journaldemontreal.com': 'Tres elevee', 'tvasports.ca': 'Tres elevee',
  'rds.ca': 'Tres elevee', 'sports.yahoo.com': 'Tres elevee',
  'nhl.com': 'Tres elevee', 'sportsnet.ca': 'Tres elevee',
  'qub.ca': 'Elevee', 'thehockeynews.com': 'Elevee', 'chl.ca': 'Elevee',
  'hockeycanada.ca': 'Elevee',
  'bpmsports.ca': 'Moyenne', 'marqueur.com': 'Moyenne',
  'hockeylemagazine.com': 'Moyenne', 'danslescoulisses.com': 'Moyenne',
  'lapochebleue.com': 'Moyenne', 'habsolumentfan.com': 'Moyenne',
  'dose.ca': 'Moyenne', 'yardbarker.com': 'Moyenne', 'thehockeywriters.com': 'Moyenne',
  'sportsaddik.com': 'Faible', 'oursportscentral.com': 'Faible', 'livebarn.com': 'Faible'
};

// ============================================================================
//  CONFIG — RESEAUX SOCIAUX (comptes MYM uniquement, + collabs ex. MYM x RDS)
// ============================================================================
//  Impressions EXACTES via API officielles. Renseigner une fois les "Script
//  Properties" (Projet Apps Script > Parametres du projet > Proprietes du script):
//   META_PAGE_ID, META_IG_USER_ID, META_ACCESS_TOKEN,
//   LINKEDIN_ORG_URN, LINKEDIN_TOKEN, X_USER_ID, X_BEARER_TOKEN
//  (Voir apps-script/GUIDE-jetons-reseaux-sociaux.md)

// ============================================================================
//  ONGLETS / EN-TETES
// ============================================================================

var T_COMPLET = 'Rapport complet';
var T_ENLIGNE = 'En ligne';
var T_SOCIAL  = 'Reseaux sociaux';
var T_LEGENDE = 'Legende';

var H_COMPLET = ['Canal','Date reperage','Marque / Compte','Plateforme / Media','Titre / Description','Lien','Date publication','Impressions / Portee','Notes'];
var H_ENLIGNE = ['Date reperage','Marque / Mot-cle','Titre de l\'article','Media / Source','URL','Date publication','Type de media','Portee presse (estimee)','Notes'];
var H_SOCIAL  = ['Date reperage','Compte MYM','Plateforme','Date publication','Description du post','Lien','Impressions','Portee (reach)','J\'aime','Commentaires','Partages','Notes'];

// ============================================================================
//  POINT D'ENTREE GLOBAL (declenche chaque vendredi)
// ============================================================================

function majHebdomadaire() {
  construireRapport();
  majPresse();
  majReseauxSociaux();
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

  if (enl.getLastRow() < 2) {
    PRESS_SEED.forEach(function (r) { ecrirePresse_(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]); });
  }
  var soc = ss.getSheetByName(T_SOCIAL);
  if (soc.getLastRow() < 2 && !jetonsSociauxPresents_()) {
    soc.getRange(2, 1).setValue('A CONNECTER — ajoutez les jetons des comptes MYM (voir GUIDE), puis lancez majReseauxSociaux.')
       .setFontColor('#B00000').setFontStyle('italic');
  }
  ss.toast('Rapport construit / verifie.', 'Veille MYM', 5);
}

// ============================================================================
//  PRESSE / WEB  (Google News, juin 2026+)
// ============================================================================

function majPresse() {
  var urls = urlsExistantes_(T_ENLIGNE, H_ENLIGNE.indexOf('URL') + 1);
  var auj = dateStr_(new Date());
  REQUETES.forEach(function (q) {
    chercherGoogleNews_(q).forEach(function (a) {
      if (a.datePub && a.datePub < DATE_MIN) return; // ignore tout ce qui est avant juin 2026
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
//  RESEAUX SOCIAUX  (comptes MYM)
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
//  LEGENDE
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
    ['Periode', 'Seulement les articles publies a partir de juin 2026 (DATE_MIN).'],
    ['Mise a jour', 'Automatique chaque vendredi 8h (presse via Google News; social via API).']
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
//  ARTICLES DE BASE — juin 2026 (fournis par le doc Groupe OG + repere le 2026-06-18)
//  [dateRep, marque, titre, media, url, datePub, type, portee]
// ============================================================================

var PRESS_SEED = [
 ['2026-06-18','Make Your Move Showdown','C\'est sur que les habiletes sont la - Zach Fucale a affronte Alexander Zharovsky dans la KHL','Journal de Quebec','https://www.journaldequebec.com/2026/06/16/cest-sur-que-les-habiletes-sont-la-zach-fucale-a-affronte-alexander-zharovsky-dans-la-khl-lan-dernier','2026-06-16','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','C\'est sur que les habiletes sont la - Zach Fucale a affronte Alexander Zharovsky dans la KHL','TVA Sports','https://www.tvasports.ca/article/c-est-sur-que-les-habiletes-sont-la-zach-fucale-a-affronte-alexander-zharovsky-dans-la-khl-l-an-dernier-140124441','2026-06-16','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','C\'est sur que les habiletes sont la - Zach Fucale a affronte Alexander Zharovsky dans la KHL','Journal de Montreal','https://www.journaldemontreal.com/2026/06/16/cest-sur-que-les-habiletes-sont-la-zach-fucale-a-affronte-alexander-zharovsky-dans-la-khl-lan-dernier','2026-06-16','Article web','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','Fucale croit au potentiel de Zharovsky (video)','RDS','https://www.rds.ca/hockey/canadiens/videos/2026/06/16/fucale-croit-au-potentiel-de-zharovsky/','2026-06-16','Video','Tres elevee'],
 ['2026-06-18','Make Your Move Showdown','C\'est sur que les habiletes sont la - Zach Fucale a affronte Alexander Zharovsky','QUB Radio','https://www.qub.ca/article/c-est-sur-que-les-habiletes-sont-la-zach-fucale-a-affronte-alexander-zharovsky-dans-la-khl-l-an-dernier-140124441','2026-06-16','Article web','Elevee'],
 ['2026-06-18','Make Your Move Showdown','Canadiens Prospect To Appear At The Make Your Move Showdown','The Hockey News','https://thehockeynews.com/nhl/montreal-canadiens/latest-news/canadiens-prospect-to-appear-at-the-make-your-move-showdown','2026-06','Article web','Elevee'],
 ['2026-06-18','Make Your Move Showdown','Zharovsky / Fucale - Make Your Move','Marqueur.com','https://www.marqueur.com/news/index.php?no=592464','2026-06','Article web','Moyenne'],
 ['2026-06-18','Make Your Move Showdown','De quoi a l\'air Zharovsky en vrai (balado)','BPM Sports','https://bpmsports.ca/podcast/de-quoi-a-lair-zharovsky-en-vrai/','2026-06','Balado','Moyenne']
];

# Veille médias — Make Your Move (MYM) / Living Sisu / Showdown

Surveillance automatique **chaque vendredi** des mentions des marques (presse
web + réseaux sociaux MYM), avec un Google Sheet structuré en onglets.

## Onglets produits

| Onglet | Contenu | Source |
|---|---|---|
| **Rapport complet** | Tout (en ligne + réseaux) | combiné |
| **En ligne** | Articles presse / web | Google News (gratuit) |
| **Réseaux sociaux** | Posts des comptes **MYM** (IG, FB, LinkedIn, X) + collabs (ex. MYM x RDS) | API officielles |
| **Légende** | Explications | — |

## Installation (une fois)

1. Ouvrir le Google Sheet → **Extensions ▸ Apps Script**.
2. Coller `apps-script/VeilleMedias.gs`, sauvegarder.
3. Lancer **`construireRapport`** → crée les onglets + remplit la presse déjà trouvée.
4. Lancer **`installerDeclencheurHebdo`** → exécution auto chaque **vendredi 8h**.

## Réseaux sociaux — branchement des comptes MYM

Les **impressions exactes** des posts viennent des API officielles. Il faut
ajouter une fois les jetons dans **Apps Script ▸ Paramètres du projet ▸
Propriétés du script** (clé = valeur) :

| Clé | Valeur |
|---|---|
| `META_PAGE_ID` | ID de la Page Facebook *Make Your Move* |
| `META_IG_USER_ID` | ID du compte Instagram Business MYM |
| `META_ACCESS_TOKEN` | Jeton Meta long-lived (perms : `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, `read_insights`) |
| `LINKEDIN_ORG_URN` | `urn:li:organization:XXXX` de la page MYM |
| `LINKEDIN_TOKEN` | Jeton OAuth LinkedIn (`r_organization_social`) |
| `X_USER_ID` | ID numérique du compte X/Twitter MYM |
| `X_BEARER_TOKEN` | Bearer token X API v2 (palier payant requis pour les impressions) |

Puis lancer **`majReseauxSociaux`**. Tant qu'aucun jeton n'est présent, l'onglet
*Réseaux sociaux* affiche un rappel et seule la presse est remplie.

> ℹ️ Le plus simple pour Meta : créer une app sur developers.facebook.com,
> connecter la Page + le compte Instagram Business MYM, générer un jeton
> long-lived. (Une alternative sans code : exporter manuellement depuis Meta
> Business Suite / LinkedIn Analytics / X Analytics et coller dans l'onglet.)

## À propos des impressions

- **Presse / articles** : pas d'impressions exactes publiées → colonne *Portée
  presse (estimée)* = niveau qualitatif (Très élevée → Faible) selon le média.
- **Réseaux sociaux MYM** : impressions **exactes** une fois les comptes connectés.

## Intégration Todoist (MCP pour Claude Code)

Ce dépôt fournit un serveur **MCP Todoist** préconfiguré dans `.mcp.json`. À
l'ouverture d'une session Claude Code dans ce dépôt, le serveur `todoist` est
proposé automatiquement.

**Authentification** : dans une session Claude Code, lancer `/mcp`, choisir
`todoist`, puis suivre le flux OAuth dans le navigateur pour connecter votre
compte Todoist. (Le serveur officiel est `https://ai.todoist.net/mcp`.)

**Pour l'avoir dans *tous* vos projets** (pas seulement ce dépôt), ajoutez-le
une fois au scope utilisateur :

```bash
claude mcp add --transport http --scope user todoist https://ai.todoist.net/mcp
```

Vérifier : `claude mcp list`. Les serveurs MCP ne sont chargés qu'au démarrage
d'une session — ouvrez une nouvelle session après l'ajout.

## Mots-clés presse surveillés

`Make Your Move Showdown`, `Make Your Move` (hockey), `Living Sisu`, `LSHL`,
`Zachary Fucale`. (« Showdown » seul est exclu : trop générique.) Modifiables en
haut du script (`REQUETES`).

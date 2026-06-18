# Guide — Obtenir les jetons API des comptes MYM (réseaux sociaux)

Objectif : permettre au script de sortir automatiquement les posts **Make Your
Move (MYM)** avec leurs **impressions**. À faire **une seule fois**. Ensuite,
tout se met à jour seul chaque vendredi.

Où coller les valeurs obtenues : dans le projet Apps Script →
**⚙️ Paramètres du projet ▸ Propriétés du script ▸ Ajouter une propriété**
(clé = valeur, exactement comme les noms ci-dessous).

---

## 1) Meta — Instagram + Facebook (Make Your Move)

> Couvre l'IG Business MYM **et** la Page Facebook MYM avec un seul jeton.

1. Aller sur https://developers.facebook.com/ → **My Apps ▸ Create App** (type
   « Business »).
2. Ajouter le produit **Instagram Graph API** + **Facebook Login**.
3. Le compte **Instagram doit être un compte « Business »** lié à la **Page
   Facebook MYM** (dans les réglages Instagram ▸ Compte professionnel).
4. Ouvrir le **Graph API Explorer**, choisir l'app, et autoriser ces permissions :
   `pages_show_list`, `pages_read_engagement`, `read_insights`,
   `instagram_basic`, `instagram_manage_insights`.
5. Générer un **jeton longue durée** (long-lived, ~60 jours) :
   - Graph API Explorer → générer le token, puis l'échanger via
     **Access Token Debugger** ▸ « Extend Access Token ».
6. Récupérer les IDs :
   - `META_PAGE_ID` : appeler `me/accounts` → champ `id` de la Page MYM.
   - `META_IG_USER_ID` : appeler `{PAGE_ID}?fields=instagram_business_account`.

| Clé à créer | Valeur |
|---|---|
| `META_ACCESS_TOKEN` | le jeton longue durée |
| `META_PAGE_ID` | ID de la Page Facebook MYM |
| `META_IG_USER_ID` | ID du compte Instagram Business MYM |

> ⚠️ Le jeton longue durée expire ~60 jours : le régénérer, ou passer par un
> **System User token** (Business Settings ▸ Users ▸ System Users) qui, lui,
> n'expire pas — recommandé pour du long terme.

---

## 2) LinkedIn — Page MYM

1. https://www.linkedin.com/developers/ → **Create app**, l'associer à la
   **Page LinkedIn MYM**.
2. Demander le produit **« Community Management API »** (approbation requise).
3. Permissions : `r_organization_social`, `rw_organization_admin`.
4. Générer le jeton OAuth, et récupérer l'URN de l'organisation :
   `urn:li:organization:XXXXXX` (visible dans l'admin de la page / via l'API
   `organizationAcls`).

| Clé à créer | Valeur |
|---|---|
| `LINKEDIN_TOKEN` | jeton OAuth |
| `LINKEDIN_ORG_URN` | `urn:li:organization:XXXXXX` |

> Les impressions LinkedIn se récupèrent via
> `organizationalEntityShareStatistics` (le script pose la base ; on branchera
> la métrique précise une fois le jeton en place).

---

## 3) X / Twitter — Compte MYM

1. https://developer.x.com/ → créer un projet + app.
2. ⚠️ Les **impressions** (`non_public_metrics`) exigent un palier **payant**
   (Basic/Pro) et l'authentification **du propriétaire** du compte MYM
   (OAuth 2.0 user context). Le **like/retweet/reply** est dispo plus largement.
3. Récupérer le **Bearer token** et le **User ID** numérique du compte MYM
   (via `users/by/username/{handle}`).

| Clé à créer | Valeur |
|---|---|
| `X_BEARER_TOKEN` | Bearer token |
| `X_USER_ID` | ID numérique du compte MYM |

---

## Après avoir tout collé

1. Dans Apps Script, lancer **`majReseauxSociaux`** une fois (autoriser l'accès).
2. Vérifier l'onglet **Réseaux sociaux** : les posts MYM doivent apparaître avec
   impressions/portée.
3. C'est tout — le déclencheur du vendredi s'en occupe ensuite.

> Pas envie de gérer des jetons ? Alternative sans code : exporter manuellement
> depuis **Meta Business Suite**, **LinkedIn Analytics** et **X Analytics**, puis
> coller dans l'onglet *Réseaux sociaux*. Moins automatique, mais zéro config.

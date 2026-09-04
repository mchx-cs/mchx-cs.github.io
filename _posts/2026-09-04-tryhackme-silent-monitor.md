---
title: "TryHackMe - Silent Monitor"
platform: "TryHackMe"
difficulty: "Medium"
tags: [sqli,auth bypass,command injection,filter bypass,keepass cracking,privesc]
---

## Résumé

Silent Monitor est une machine TryHackMe centrée sur une application web interne de supervision réseau ("CorpNet NOC"), exposée sur le port 5050. La chaîne de compromission complète part d'une injection SQL sur le formulaire de connexion, permettant de contourner l'authentification, puis exploite une injection de commande OS filtrée (avec limite de longueur et blocklist de caractères) sur une fonctionnalité de "health check" ping pour obtenir une exécution de code en tant que www-data. La lecture du code source applicatif et d'un fichier de configuration révèle des identifiants d'un compte système, permettant un pivot en SSH. L'exploration du répertoire personnel de ce compte mène à une base de données KeePass cassée hors-ligne, dont une entrée contient le mot de passe root.

## Outils/Technos Utilisés

Reconnaissance

- Nmap
- Navigateur web (inspection du code source)
- Gobuster

Exploitation initiale

- Burp Suite (Repeater)
- Python 3 (reverse shell)
- Netcat (listener)

Élévation de privilèges

- SSH / SCP
- keepass2john
- John the Ripper
- KeePassXC CLI

## Reconnaissance

Un scan Nmap complet révèle deux ports ouverts sur la cible (<<target>>) :

```bash
nmap -sC -sV -p- -T4 <<target>>
```
22/tcp — SSH (OpenSSH 8.9p1 Ubuntu)
5050/tcp — HTTP (Werkzeug 2.0.2 / Python 3.10.12), page titrée "CorpNet — Network Operations Centre"

L'application web sur le port 5050 est la page d'accueil publique de "CorpNet NOC" (Network Operations Centre), présentant trois fonctionnalités : Uptime Monitoring, Incident Alerting et Operator Audit Trail — chacune associée à une icône SVG dans le code source (pas d'information cachée dans ces SVG, simples icônes décoratives).

```bash
gobuster dir -u http://<<target>>:5050/ -w /usr/share/wordlists/dirb/common.txt -x php,txt,html,json -t 50
/internal    (Status: 200) [Size: 8770]
```

/internal héberge un formulaire de connexion "Sign In to NOC Portal" (POST /internal, champs username/password), avec le message d'erreur générique "Invalid username or password." sur échec.

## Exploitation initiale

Bypass d'authentification par injection SQL

Le formulaire de login ne filtre pas correctement les entrées. Une injection classique sur le champ username permet de contourner l'authentification :

```bash
POST /internal
Content-Type: application/x-www-form-urlencoded

username=' OR '1'='1' --&password=password
};
```

Le serveur répond par une redirection 302 vers /internal/dashboard accompagnée d'un nouveau cookie de session (Set-Cookie: session=...), signe que l'injection a cassé la requête SQL sous-jacente et validé l'authentification malgré des identifiants inconnus. En rejouant proprement ce cookie de session (un seul header Cookie:, sans doublon), l'accès au dashboard "CorpNet NOC" est confirmé avec le rôle operator.

Le dashboard révèle une page "Host Health" (/internal/health) et un audit log affichant, entre autres, des tentatives de health check contenant des motifs d'injection (%0a suivi d'une commande) — un indice fort vers la fonctionnalité suivante.

Injection de commande OS sur /internal/health

/internal/health propose un champ texte pour lancer un ping vers une adresse fournie par l'utilisateur. Les séparateurs de commande classiques (;, &&) sont rejetés par une validation côté serveur ("Invalid hostname or IP address."), mais un saut de ligne encodé (%0a) contourne le filtre :

```bash
target=127.0.0.1%0awhoami
```

La réponse contient la sortie normale du ping suivie du résultat de la commande injectée (www-data), confirmant une exécution de commande arbitraire en tant qu'utilisateur du serveur web.

Contournement du filtrage pour un reverse shell

L'obtention d'un shell interactif s'est heurtée à plusieurs protections découvertes par bissection (testées un caractère/fragment à la fois) :

- Une blocklist de caractères rejetant notamment ;, |, `, $ et & (donc les techniques classiques bash -i >& /dev/tcp/... ou nc -e sont bloquées ou inutilisables — nc -e s'est par ailleurs révélé absent du binaire netcat installé sur la cible).
- Une limite de longueur de 100 caractères sur le champ target, empêchant l'envoi direct d'un payload de reverse shell Python complet en une seule requête.

Le contournement retenu consiste à écrire un script Python de reverse shell sur le disque via une série de requêtes courtes (echo '<ligne>' >> /tmp/r.py, chacune sous la limite de 100 caractères), puis à l'exécuter en une dernière requête (python3 /tmp/r.py), avec un listener Netcat en écoute côté attaquant. Cette approche permet d'obtenir un shell interactif complet en tant que www-data.

La lecture ultérieure du code source de l'application (app.py, accessible en lecture depuis le shell obtenu) confirme précisément ces protections : requête SQL construite par concaténation de chaîne sans paramétrage pour le login, appel subprocess.Popen("ping ... " + target, shell=True) pour le health check, filtre re.compile(r"[;|$&]"), et contrôle explicite len(target) > 100 — sans aucune protection contre l'injection de saut de ligne (%0a`), commentée dans le code comme faille connue.

## Élévation de privilèges

Une énumération classique (sudo -l, binaires SUID, cron, fichiers writables, capabilities) depuis le shell www-data ne révèle rien d'exploitable directement, en dehors d'un fichier applicatif inscriptible (/opt/netops/netops.db, base SQLite de l'application).

La lecture du fichier de configuration /opt/netops/secret.config (lisible par le groupe www-data) révèle en revanche un compte de service en clair, utilisé par un "backup agent" :

```bash
[backup_agent]
run_as   = sysadmin
password = <<CENSURE>>
```

Ces identifiants permettent une connexion SSH directe en tant que sysadmin. Ce compte ne dispose d'aucun droit sudo. L'exploration de son répertoire personnel révèle un dossier backups/ contenant une base de données KeePass (infrastructure.kdbx), décrite par un README.txt comme un export périodique automatique du coffre-fort de mots de passe de l'infrastructure.

La base est exfiltrée puis cassée hors-ligne :

```bash
scp sysadmin@<<target>>:/home/sysadmin/backups/infrastructure.kdbx .
keepass2john infrastructure.kdbx > hash.txt
john --wordlist=/usr/share/wordlists/rockyou.txt hash.txt
```

Le mot de passe maître est cassé quasi instantanément par John the Ripper. Une fois la base ouverte, une entrée nommée "Root User Password - Sensitive" contient les identifiants du compte root de la machine :

```bash
keepassxc-cli show infrastructure.kdbx "Root User Password - Sensitive" -a Password
```

Ce mot de passe permet un su root réussi depuis la session SSH sysadmin, complétant la compromission totale de la machine.


## Flags Trouvés

- user.txt : <<CENSURE>>
- root.txt : <<CENSURE>>

## Conclusion

Silent Monitor illustre bien comment une chaîne de vulnérabilités web "classiques" mais mal corrigées peut mener à une compromission complète : une injection SQL triviale sur un login pour l'accès initial, une injection de commande OS avec un filtrage incomplet (blocklist de caractères contournable et limite de longueur contournable en fragmentant le payload) pour l'exécution de code, puis une mauvaise gestion des secrets (mot de passe en clair dans un fichier de configuration lisible, export automatique non protégé d'un coffre-fort de mots de passe) pour l'élévation de privilèges jusqu'à root. Un point notable de la méthodologie a été la bissection systématique du filtre applicatif — tester des fragments de payload un par un pour isoler précisément les caractères et la limite de longueur bloqués — bien plus efficace qu'une approche par essais-erreurs sur le payload complet.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

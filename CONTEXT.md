# FTP Sync Watcher

Domain-Modell für das VS-Code-Plugin, das lokale Dateien mit FTP/SFTP-Servern synchronisiert. Bidirektionaler Sync ist modelliert, aber heute nur in der `localToRemote`-Richtung implementiert.

## Language

**Profile**:
Die Konfiguration für eine Sync-Beziehung zwischen einem lokalen Pfad und einem entfernten Pfad. Identifiziert durch den absoluten Pfad zu seiner Konfigurationsdatei. Ein Workspace kann mehrere Profile enthalten (z.B. eines pro Sync-Richtung).
_Avoid_: Config, Connection Profile, Server, Server-Config

**Direction**:
Die Richtung, in die ein Profile synchronisiert. Werte sind `localToRemote`, `remoteToLocal`, `bidirectional`.
_Avoid_: Mode, Sync Mode, Push/Pull (Werte, keine Konzept-Namen)

**Trigger**:
Eine Bedingung, die einen Transfer auslöst. Drei vordefinierte Trigger im Plugin: `OnSaveTrigger`, `OnChangeTrigger`, `OnDeleteTrigger`. Jeder Trigger kann pro Profile unabhängig aktiviert werden.
_Avoid_: Watcher (zu eng, der Watcher ist die Komponente, die Trigger auswertet), Auto-Upload, Auto-Delete, Event

**Sync**:
Die Übertragung von Dateien zwischen lokal und entfernt gemäß der Direction eines Profiles. Wird heute als `localToRemote` ausgeführt; das Modell hält `bidirectional` als Zielzustand offen.
_Avoid_: Upload (zu eng), Mirror (impliziert Bidirektionalität), Publish, Replication

**Tombstone**:
Eine Markierung, dass eine Datei gelöscht wurde, zusammen mit einer Schutzfrist, in der die Löschung nicht auf die Gegenseite propagiert wird. Verhindert Datenverlust durch kaskadierende Löschungen in einem bidirektionalen Modell. Lebt im globalen Zustand der Plugin-Installation.
_Avoid_: Soft-Delete, Delete-Marker, Gelöscht-Markierung

**Watcher**:
Die Plugin-Komponente, die Trigger auswertet und Transfers initiiert. Pro Workspace Folder genau eine Instanz. Verwaltet die Connection-Pools aller Profile in diesem Workspace.
_Avoid_: Sync Engine, Sync Session, Sync Coordinator

**Remote Client**:
Die Protokoll-spezifische Implementierung der Server-Kommunikation (FTP, FTPS, SFTP). Stellt Connect, Disconnect, Upload, Download, Delete und List bereit. Kennt keine Retries oder Health-Checks.
_Avoid_: Connection (überladen), FTP Client (Protokoll-spezifisch)

**Connection Pool**:
Der Lifecycle-Wrapper um einen Remote Client. Hält einen einzigen Remote Client, kümmert sich um Reconnect mit Backoff, eine Operation-Mutex (eine FTP-Operation gleichzeitig) und periodische Health-Checks. Pro Profile genau eine Instanz.
_Avoid_: Connection (überladen), Pool, Session

**Connection Slot**:
Eine atomare Berechtigung, eine TCP-Verbindung zu einem Server zu halten. Wird cross-Pool über alle Profile des Workspaces vergeben. Beschränkt die Anzahl gleichzeitiger Verbindungen pro Server.
_Avoid_: Connection (überladen), Lock, Permit

**Explorer**:
Die VS-Code-Tree-View, die den entfernten Verzeichnisbaum darstellt. Hat einen eigenen Remote Client, unabhängig vom Connection Pool der Profile.
_Avoid_: FTP Explorer (Protokoll-spezifisch), Remote-Browser, Tree View

**Workspace Folder**:
Eine Wurzel im Multi-Root-Workspace von VS Code. Trägt die Identität der Profile (über den Pfad zur Konfigurationsdatei). Pro Workspace Folder höchstens eine Konfigurationsdatei, diese kann mehrere Profile enthalten.
_Avoid_: Project, Root, Working Directory

**Operation**:
Eine einzelne, abgeschlossene Datei-Übertragung in einer festgelegten Richtung. Hat eine Priorität, ein Timeout und eine Retry-Obergrenze. Wird durch einen Trigger angestoßen oder durch einen Command.
_Avoid_: Task, Job, Action, Request

**Transfer**:
Das Ergebnis einer Operation: Erfolg oder Fehler, mit den beteiligten Pfaden. Transfer ist richtungsneutral (Upload und Download liefern denselben Typ).
_Avoid_: Upload Result, Download Result, File-Op

**Status**:
Der aggregierte Zustand des Plugins aus User-Sicht. Werte: `unconfigured`, `idle`, `watching`, `syncing`, `error`. Nicht pro Connection, sondern plugin-weit.
_Avoid_: State (zu generisch), Connection State (zu eng)
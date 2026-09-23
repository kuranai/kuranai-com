# Repository instructions

`IMPLEMENTATION.md` is the canonical source for implementation status and phase selection.

When the user asks to implement the next phase:

1. Follow the working protocol in `IMPLEMENTATION.md`.
2. Work on exactly one phase: resume `IN PROGRESS` first, otherwise use `NEXT`.
3. Read only the planning sections selected by its context-routing table.
4. Update `IMPLEMENTATION.md` before work starts and again when the phase finishes or becomes blocked.
5. Stop after that phase; do not begin the following phase in the same turn.

## Ausführungsumgebung

Shell-Befehle in diesem Repository standardmäßig außerhalb der Sandbox mit der erweiterten
Ausführungsfreigabe ausführen, damit Benutzer-, Netzwerk- und Tool-Konfiguration der normalen
Serverumgebung verwendet werden. Übergeordnete Sicherheitsregeln und erforderliche
Benutzerfreigaben bleiben maßgeblich; falls ein Befehl nicht erweitert ausgeführt werden kann, die
Abweichung transparent melden.

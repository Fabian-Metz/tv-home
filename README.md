# Home

Ein ruhiger, werbefreier Startbildschirm für Samsung-Fernseher mit Tizen, gebaut als Modul für [TizenBrew](https://github.com/reisxd/TizenBrew). Entwickelt für einen Samsung UE55RU7099 (2019, Tizen 5).

Acht große Kacheln für das, was wirklich genutzt wird, darunter eine Zeile mit den übrigen Apps. Keine Werbung, keine Empfehlungen, keine Internetzugriffe außer dem Laden des Moduls selbst.

## Was es kann

- **YouTube** öffnet TizenTube (werbefrei, mit SponsorBlock).
- **Prime Video, Disney+, ARD, ZDF, ARTE** öffnen die normalen TV-Apps. Anmeldung und Bildqualität bleiben unverändert.
- **Xbox** schaltet auf den HDMI-Eingang um.
- **Einstellungen** öffnet das Einstellungsmenü des Fernsehers.
- **Weitere Apps** zeigt alle übrigen installierten Apps. Samsung-Beigaben sind ausgeblendet.

## Tasten

| Taste | Wirkung |
|---|---|
| Pfeile, OK | bewegen, öffnen |
| Gelb | Diagnose: alle installierten Apps mit ihren Kennungen |
| Rot | Seite neu laden |
| Zurück | macht auf dem Startbildschirm nichts |

Nach 10 Minuten ohne Eingabe bleibt nur die Uhr sichtbar. Die erste Taste weckt den Bildschirm wieder auf.

## Installieren

1. TizenBrew auf dem Fernseher installieren (Entwicklermodus an).
2. In den Entwickler-Einstellungen des Fernsehers die **Host PC IP auf `127.0.0.1`** stellen. TizenBrew braucht das, um Module zu starten.
3. TizenBrew öffnen, **grüne Taste** (Modul-Manager), **Add GitHub Module**, dann `Fabian-Metz/tv-home` eingeben.
4. **Home** aus der Modulliste öffnen.
5. Beim ersten Druck auf Xbox oder Einstellungen fragt der Fernseher einmal, ob „Home“ ihn steuern darf. Mit **Zulassen** bestätigen.

### Direkt in Home starten

1. In TizenBrew unter Einstellungen **Home als Autostart-Modul** wählen.
2. Am Fernseher: Einstellungen → Allgemein → Smart-Funktionen → **Letzte App automatisch ausführen: Ein** und **Smart Hub automatisch ausführen: Aus**.

## Anpassen

Alles steht in [`app/config.js`](app/config.js): Kacheln, Farben, HDMI-Eingang der Xbox, ausgeblendete Apps. Ändern, committen, pushen, dann am Fernseher die rote Taste drücken.

TizenBrew lädt die Dateien über jsDelivr. Dort kann eine Änderung bis zu 12 Stunden zwischengespeichert sein.

Öffnet eine Kachel nichts: gelbe Taste drücken, den Namen der App in der Liste suchen und `match` in `config.js` anpassen.

## Aufbau

```
package.json          Beschreibung des Moduls für TizenBrew
app/index.html        die Seite
app/style.css         Aussehen
app/config.js         deine Kacheln
app/main.js           Bedienung
service/service.js    kleiner Dienst auf dem TV: App-Liste, Apps starten, Tasten senden
```

Die Seite darf selbst keine TV-Funktionen aufrufen. Deshalb läuft der Dienst daneben. Er lauscht nur auf dem Fernseher selbst (127.0.0.1) und beantwortet nur Anfragen dieser Seite.

Seite und Dienst sind bewusst in altem JavaScript (ES5) geschrieben, weil der Browser-Kern von Tizen 5 alt ist.

## Vorschau am Rechner

`app/index.html` im Browser öffnen. Pfeiltasten und Enter bedienen, `Y` ist Gelb, `R` ist Rot. Die App-Liste besteht dort aus Beispieldaten, gestartet wird nichts.

## Dank

Die Technik (TizenBrew-Modul mit eigenem Dienst, Tasten über die Fernsteuer-Schnittstelle des TV) folgt den offenen Projekten [TVDeck](https://github.com/AtfastrSlushyMaker/tvdeck) und [tv-launcher](https://github.com/SebastianBEllingsen/tv-launcher), beide MIT-lizenziert.

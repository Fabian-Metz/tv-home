/*
 * Hier stellst du den Startbildschirm ein. Aendern, committen, pushen.
 * Am TV danach die ROTE Taste druecken (laedt neu).
 *
 * Jede Kachel hat einen Typ:
 *   module  = ein TizenBrew-Modul (z. B. TizenTube). "match" sucht im Modulnamen.
 *   app     = eine normale TV-App. "match" sucht im App-Namen, den der TV meldet.
 *             "ids" sind Ersatz-Kennungen, falls der TV keine App-Liste liefert.
 *   key     = sendet eine Fernbedienungstaste (z. B. KEY_HDMI1 fuer einen HDMI-Eingang).
 *
 * Die GELBE Taste am TV zeigt alle installierten Apps mit ihren Kennungen.
 */
window.HOME_CONFIG = {
  // Zwei Reihen mit je vier grossen Kacheln.
  favorites: [
    [
      { name: 'YouTube', sub: 'TizenTube', type: 'module', match: 'tizentube', color: ['#f0473c', '#7d1410'] },
      { name: 'Prime Video', type: 'app', match: 'prime video|amazon', ids: ['3201910019365', 'org.tizen.primevideo'], color: ['#1b9fd8', '#0b3f5e'] },
      { name: 'Disney+', type: 'app', match: 'disney', ids: ['3201901017640'], color: ['#2c50c9', '#0c1b55'] },
      { name: 'Xbox', sub: 'HDMI 1', type: 'key', key: 'KEY_HDMI1', color: ['#2ea043', '#0f4a1c'] }
    ],
    [
      { name: 'ARD', sub: 'Mediathek', type: 'app', match: '^ard\\b|ard mediathek', ids: [], color: ['#1f5fbf', '#0a2a5e'] },
      { name: 'ZDF', sub: 'Mediathek', type: 'app', match: '^zdf', ids: [], color: ['#f47b20', '#7a3608'] },
      { name: 'ARTE', type: 'app', match: '^arte', ids: [], color: ['#e8532b', '#6e1f0c'] },
      { name: 'Einstellungen', type: 'key', key: 'KEY_MENU', color: ['#6b7280', '#272b33'] }
    ]
  ],

  // Zeile "Weitere Apps": Apps, deren Name hierauf passt, werden nie gezeigt.
  hide: 'tizenbrew|samsung tv plus|bixby|e-manual|galerie|gallery|smartthings|universal guide|samsung promotion|privacy|datenschutz|^apps$',

  // Zusaetzliche Tasten-Kacheln in der unteren Zeile.
  extras: [
    { name: 'Quellen', type: 'key', key: 'KEY_SOURCE' }
  ]
};

# SPECTRA - Chrome Web Store (Deutsch)

## Name

SPECTRA - Lautstärke, Equalizer & Mediensteuerung

## Kurzbeschreibung (max. 132 Zeichen)

Bis zu 800 % Lautstärke, 10-Band-EQ, Medien- und Videosteuerung sowie eine optionale authentifizierte Handy-Fernbedienung.

## Ausführliche Beschreibung

SPECTRA bündelt Audio-, Wiedergabe- und Videosteuerung in einer Chrome-Erweiterung. Einstellungen und Medienverarbeitung bleiben standardmäßig auf dem Gerät.

### Audio

- Lautstärkeregelung bis 800 %
- 10-Band-Equalizer von 32 Hz bis 16 kHz
- Bass, Kompressor, Mono, Balance und Verzögerung
- getrennte Stummschaltung für Medium und Browser-Tab

Hohe Verstärkung kann Verzerrungen und gesundheitlich bedenkliche Pegel verursachen. Erhöhe die Lautstärke schrittweise und verwende den Kompressor passend zu Quelle und Wiedergabegerät.

### Wiedergabe und Video

- Geschwindigkeit, Wiedergabe/Pause, Suche, Schleifen, Marker und A/B-Schleife
- Drehen, Spiegeln, Füllen, Filter und Hintergrundabdunklung
- Bild-in-Bild und Vollbild über die Standardfunktionen des Browsers
- Screenshots sichtbarer Videobilder, wenn Seite und Medium die Aufnahme zulassen

Die Verfügbarkeit hängt von Seite, Medienelement, Browserunterstützung, Berechtigungen und Benutzeraktivierung ab. SPECTRA meldet nicht unterstützte Vorgänge, statt identisches Verhalten auf jeder Website zu versprechen.

### Optionale Handy-Fernbedienung

Erstelle eine Kopplungssitzung und scanne den QR-Code. Das Steuergerät muss eine HMAC-SHA-256-Authentifizierung abschließen, bevor es Statusdaten erhält oder Befehle senden kann.

Die Fernbedienung ist standardmäßig deaktiviert. Bei Aktivierung nutzt sie Cloudflare Pages, PeerJS-Signalisierung sowie STUN- und TURN-Dienste. Nach der Authentifizierung können Titel, Domain und Mediensteuerungsstatus des ausgewählten Tabs mit dem gekoppelten Gerät ausgetauscht werden. Seiteninhalt, Favicons, Audio und Video werden nicht über den Fernkanal übertragen.

### Einstellungen und Tastenkürzel

- lokale globale und websitespezifische Einstellungen
- konfigurierbare Medien-Tastenkürzel
- mehrsprachige Benutzeroberfläche
- bestätigter Ist-Zustand für Popup und authentifizierte Fernbedienung

### Datenschutz

SPECTRA enthält keine Werbung, Analyse, Telemetrie oder vom Entwickler betriebene Datensammlung. Einstellungen und Medienverarbeitung bleiben standardmäßig lokal. Der optionale Netzwerkverkehr der Fernbedienung ist oben und in der Datenschutzerklärung beschrieben.

SPECTRA umgeht keine Browser-Sicherheitsmechanismen, Berechtigungen, Einschränkungen geschützter Inhalte oder Anforderungen an Benutzeraktivierung.
# MP3 Segment Cut

Version **0.2.1**

Kleine MP3s im Browser schneiden und einzelne Segmente herunterladen. Die App öffnet und verarbeitet Audiodaten im Arbeitsspeicher des Tabs. Der Docker-Container liefert die Oberfläche aus und erhält keine Audiodateien.

## Starten

In Komodo einen Stack mit dem Repo `forke24x7/MP3SegmentCut`, Branch `main` und Dateipfad `docker-compose.yaml` anlegen. Die Datei kann auch direkt als Compose-Text eingefügt werden. Sie lädt `ghcr.io/forke24x7/mp3segmentcut:latest`.

Lokal reicht die `docker-compose.yaml`. Im selben Verzeichnis ausführen.

```sh
docker compose up -d
```

Die App ist unter [localhost:8080](http://localhost:8080) erreichbar. Für Zugriff aus dem LAN `BIND_ADDRESS=0.0.0.0` als Umgebungsvariable im Stack setzen und die IP des Docker-Hosts öffnen. Der Port lässt sich mit `PORT` ändern.

Für einen lokalen Build aus dem geklonten Quellcode beide Dateien verwenden.

```sh
docker compose -f docker-compose.yaml -f compose.build.yaml up --build -d
```

## Schneiden

MP3 öffnen oder hineinziehen (Mono oder Stereo, bis 25 MB und 15 Minuten). Die **Pegelkurve** macht leise und laute Stellen sichtbar. Das **Spektrogramm** zeigt die Frequenzanteile. Mit **+** und **−** zoomen. In der Grafik einen Bereich aufziehen oder Start und Ende in Sekunden eingeben. Danach **Auswahl anhören** und **MP3 speichern** wählen.

Der Export codiert das Segment mit 192 kbit/s bei 44,1 kHz neu. Durch MP3-Encoderverzögerung und Auffüllung kann die Datei geringfügig länger ausfallen.

## Lizenz

Die App steht unter der [MIT-Lizenz](LICENSE). Der beim Image-Build geladene [LAME-JavaScript-Encoder 1.2.1](https://github.com/zhuker/lamejs) steht unter der LGPL und basiert auf [LAME](https://lame.sourceforge.net/).

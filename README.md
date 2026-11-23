# MP3 Segment Cut

Kleine MP3s im Browser schneiden und einzelne Segmente herunterladen. Die App öffnet und verarbeitet Audiodaten im Arbeitsspeicher des Tabs. Der Docker-Container liefert die Oberfläche aus und erhält keine Audiodateien.

## Starten

Repository klonen und im Projektordner ausführen.

```sh
docker compose up --build -d
```

Die App ist unter [localhost:8080](http://localhost:8080) erreichbar. Für Zugriff aus dem LAN mit `BIND_ADDRESS=0.0.0.0 docker compose up -d` starten und die IP des Docker-Hosts öffnen. Der Port lässt sich über `PORT` ändern. Zum Stoppen `docker compose down` ausführen.

## Schneiden

MP3 öffnen oder hineinziehen (Mono oder Stereo, bis 25 MB und 15 Minuten). Die **Pegelkurve** macht leise und laute Stellen sichtbar. Das **Spektrogramm** zeigt die Frequenzanteile. Mit **+** und **−** zoomen. In der Grafik einen Bereich aufziehen oder Start und Ende in Sekunden eingeben. Danach **Auswahl anhören** und **MP3 speichern** wählen.

Der Export codiert das Segment mit 192 kbit/s bei 44,1 kHz neu. Durch MP3-Encoderverzögerung und Auffüllung kann die Datei geringfügig länger ausfallen.

## Lizenz

Die App steht unter der [MIT-Lizenz](LICENSE). Der beim Image-Build geladene [LAME-JavaScript-Encoder 1.2.1](https://github.com/zhuker/lamejs) steht unter der LGPL und basiert auf [LAME](https://lame.sourceforge.net/).

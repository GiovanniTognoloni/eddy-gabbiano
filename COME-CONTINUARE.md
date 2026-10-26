# 📌 Come continuare — Eddy & il Gabbiano

Promemoria per riprendere lo sviluppo del gioco.

---

## 🚀 Riprendere il lavoro con pi

Apri il terminale e vai nella cartella del progetto:

```bash
cd C:\Users\PC\dino-reverse-engineering\eddy-seagull
```

Poi avvia pi riprendendo la sessione:

```bash
pi --continue        # riprende l'ultima sessione
# oppure
pi --resume          # ti fa scegliere quale sessione riprendere
```

> Tutto il lavoro è salvato su **git** + **GitHub**, quindi non si perde nulla
> anche chiudendo pi.

---

## 🎮 Provare il gioco in locale

```bash
cd C:\Users\PC\dino-reverse-engineering\eddy-seagull
python -m http.server 8778
```
Poi apri nel browser: **http://localhost:8778**

---

## 🌍 Link online

- 🎮 Gioca: https://giovannitognoloni.github.io/eddy-gabbiano/
- 📦 Codice: https://github.com/GiovanniTognoloni/eddy-gabbiano

---

## 💾 Salvare nuove modifiche su GitHub

Dopo aver cambiato il codice:

```bash
cd C:\Users\PC\dino-reverse-engineering\eddy-seagull
git add -A
git commit -m "descrizione delle modifiche"
git push
```
GitHub Pages si aggiorna da solo dopo 1-2 minuti.

---

## 💰 Costi e abbonamento (nota)

- Sei autenticato con **OAuth (abbonamento Anthropic)**, **non** con API a consumo
  → non paghi a token, usi la quota dell'abbonamento.
- Stai usando il modello **Opus** (il più potente, consuma più quota).
- Per risparmiare quota nei lavori semplici, puoi passare a **Sonnet**:
  ```bash
  pi --model sonnet
  ```
  oppure dentro pi con **Ctrl+P** per cambiare modello al volo.
- Verifica che l'abbonamento sia **Max** (non Pro) su: claude.ai → Settings → Billing.

---

## 🗂️ Dove sono le cose

```
C:\Users\PC\dino-reverse-engineering\
├─ eddy-seagull\            ← IL GIOCO (questo progetto, su GitHub)
│  ├─ index.html            pagina + HUD
│  ├─ seagull.js            tutto il motore di gioco
│  ├─ README.md             descrizione + comandi
│  └─ COME-CONTINUARE.md    questo file
├─ eddy-puntala\            gioco precedente (Eddy a Punta Ala)
└─ ashorthike-decompiled\   analisi di A Short Hike (riferimento)
   ├─ ANALISI-PLAYER.md     fisica del personaggio
   └─ ANALISI-SISTEMI.md    sistemi (pesca, dialoghi, salvataggi...)
```

---

## ✅ Stato attuale del gioco (cosa è già fatto)

- Volo del gabbiano: flap, stamina ali, planata, picchiata, termiche
- Eddy: cammina, salta, **nuota in profondità** e pesca
- Switch personaggi (TAB) con **follow automatico** del compagno
- Tesori alti/bassi con **salvataggio persistente** (localStorage)
- **Lago naturale** con pesci, ninfee, canne, caustiche
- **NPC con dialoghi** e indizi cooperativi (tasto E)
- Puzzle cooperativo (interruttore → termica) + schermata vittoria

## 💡 Idee per continuare (non ancora fatte)

- 🏁 Gara di volo tra anelli a tempo (per il gabbiano)
- 🪏 Chest sepolti che Eddy scava
- 🌳 Più varietà di terreno (alberi, rocce, spiaggia)
- 🎒 Oggetti/strumenti (es. canna da pesca, cappelli)
- 🌅 Ciclo giorno/notte o meteo
- 🐾 Più NPC con mini-missioni

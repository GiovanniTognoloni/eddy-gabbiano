# 🕊️ Eddy & il Gabbiano — Caccia ai tesori

Remake 2D ispirato ad **A Short Hike** (fisica di volo) unito al mondo di
**Eddy a Punta Ala**. Due personaggi cooperano per raccogliere i tesori:
il **gabbiano** dall'alto (volo/planata/termiche) ed **Eddy** a terra.

HTML5 + Canvas 2D, **zero dipendenze**.

## Stato di sviluppo

- [x] **Fase 0** — Setup progetto
- [x] **Fase 1** — Volo del gabbiano (flap, stamina d'ali, planata, picchiata, termiche base)
- [x] **Fase 2** — Termiche complete + effetti reattivi (scia ali, polvere, piumette, vento dinamico)
- [x] **Fase 3** — Zampe gabbiano (in piedi a terra) + switch personaggi (gabbiano ⇄ Eddy, TAB) + camera sull'attivo
- [x] **Fase 4** — Tesori (alti/bassi) + store a tag osservabile + salvataggio localStorage + popup raccolta
- [x] **Fase 5** — Follow automatico del compagno + puzzle cooperativo (interruttore→termica) + schermata di vittoria

## Come provare

```bash
python -m http.server 8778
# apri http://localhost:8778
```

## Comandi (prototipo volo)

| Tasto | Azione |
|---|---|
| `←` `→` / `A` `D` | vira |
| `SPAZIO` | batti le ali (flap) — consuma energia |
| tieni `SPAZIO` | plana (dopo breve ritardo) |
| `↓` | picchiata (scambia quota → velocità) |
| `R` | reset |

## Fisica del volo (derivata da A Short Hike `Player.cs`)

Vedi `../ashorthike-decompiled/ANALISI-PLAYER.md` e `ANALISI-SISTEMI.md`.

- **Flap**: imposta `vy` verso l'alto, consuma **stamina di volo** (al posto
  delle piume). La stamina si **ricarica posandosi a terra**.
- **Planata**: tenendo il flap, scambi **quota ↔ velocità**. In picchiata (`↓`)
  acceleri e scendi; planando piatto rallenti e scendi poco. Drag bassissimo
  = conservi slancio e voli lontano.
- **Termiche (updraft)**: colonne d'aria che ti fanno **salire gratis** mentre
  plani — ritmo dell'esplorazione.

### Test automatici (via DevTools)
**Fase 1 ✓**
- ricarica stamina a terra: 0.3 → 1.0 in 1s
- flap: `vy ≈ -8.5`, costo energia -0.22
- planata si attiva tenendo il flap
- picchiata: `vx` da 2 → ~10.8 (scambio quota→velocità)

**Fase 2 ✓**
- termica: salita netta +95px, stamina 0.3 → 0.91 (carburante gratuito)
- piumetta ad ogni flap, polvere all'atterraggio, scia delle ali in planata

**Fase 3 ✓**
- switch TAB cicla gabbiano ⇄ Eddy; solo l'attivo riceve input; l'altro resta fermo
- gabbiano in piedi sulle zampe a terra (non più sdraiato), Eddy cammina/salta
- camera segue il personaggio attivo (es. Eddy a x=2000 → cam ≈ 1597)

**Fase 4 ✓**
- 8 tesori (4 bassi per Eddy, 4 alti per il gabbiano)
- raccolta: Eddy prende i ground, gabbiano gli air; +punti e popup
- persistenza: tag TREASURE_* in localStorage; sopravvivono al reload (2/8 → 2/8)

## Struttura

```
eddy-seagull/
├─ index.html    # pagina, HUD, barra stamina
├─ seagull.js    # motore di volo (Fase 1)
└─ README.md
```


## 🎉 Gioco completo!

Tutte le 5 fasi sono state implementate e testate nel browser.

### Meccaniche finali
- **Due personaggi** (gabbiano che vola + Eddy che cammina), switch con TAB
- **Follow automatico**: il compagno segue sempre l'attivo (niente backtracking)
- **Volo** fedele ad A Short Hike: flap, stamina d'ali, planata, termiche
- **Tesori** su due piani (alti/bassi) con salvataggio persistente
- **Cooperazione**: Eddy preme un interruttore che attiva una termica speciale,
  permettendo al gabbiano di raggiungere un tesoro altrimenti irraggiungibile
- **Vittoria** quando si raccolgono tutti gli 8 tesori

### Design dei personaggi
- Gabbiano: zampe palmate (in piedi a terra, ritratte in volo), ali animate
- Eddy: scoiattolo realistico con coda folta, orecchie a ciuffo, occhio espressivo,
  pelliccia sfumata, gambe lunghe a due segmenti (coscia + stinco)

## 🌍 Mondo vivo (ispirato ad A Short Hike)

Oltre al loop base, il mondo ora è più ricco e curioso:

### 🌊 Lago con pesca
- Un lago con acqua sfumata, onde animate e sponde
- **Pesci** (trota, carpa, dorata) che nuotano come ombre (cfr FishShadow.cs)
- Il **gabbiano li avvista dall'"'"'alto** (si illuminano) e li **pesca tuffandosi**
- **Eddy nuota**: entra in acqua, affonda, scende fino in fondo (↓) e pesca sott'"'"'acqua

### 💬 NPC con dialoghi
- Animaletti (lumaca, riccio, rana) che **gironzolano** (cfr WanderNPCMovement.cs)
- Premi **E** per **parlare** (fumetto di testo, cfr DialogueController.cs)
- Danno **indizi cooperativi**: es. la lumaca dice a Eddy dov'è una stella in cielo,
  così sai che serve il gabbiano per prenderla
# PLAN_MOBILE.md — Mobile Companion via HTTP + QR Pairing

## Obiettivo

Rendere agent-board accessibile da browser mobile (stesso WiFi) riutilizzando la WebView esistente,
aggiungendo un layer HTTP server nella extension e un flusso di pairing via QR code.

---

## Architettura Target

```
VSCode Extension (desktop)
  └── LocalApiServer (porta 3333)
        ├── GET    /           → serve asset WebView (HTML/CSS/JS)
        ├── GET    /tasks      → lista task con stato e colonna
        ├── PATCH  /tasks/:id  → aggiorna stato task
        └── POST   /tasks      → crea nuovo task

Telefono (stesso WiFi)
  └── Browser mobile
        └── http://192.168.x.x:3333  (URL da QR code)
```

---

## Task di Sviluppo

### Task 1 — Analisi codebase WebView

**Priorità:** Alta — blocca tutti gli altri task  
**Dipendenze:** nessuna

Leggi la struttura attuale della WebView: entry point HTML, come vengono caricate le card Kanban,
il message bridge (`postMessage` / `onDidReceiveMessage`).

**Output atteso:**
- Lista file coinvolti nella WebView
- Schema del bridge attuale (messaggi in/out con tipi)
- Lista dipendenze CSS/JS caricate
- Eventuali blockers per la servibilità via HTTP

---

### Task 2 — Abstraction layer DataProvider

**Priorità:** Alta  
**Dipendenze:** Task 1

Crea `src/webview/DataProvider.ts`. Deve rilevare l'ambiente runtime e
esporre metodi uniformi indipendenti dal trasporto.

**Comportamento:**
- In WebView VSCode (`typeof acquireVsCodeApi !== 'undefined'`): usa `postMessage`
- In browser mobile: usa `fetch` verso le REST API

**Interfaccia da esporre:**
```typescript
interface Task {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  provider: string
  [key: string]: unknown  // campi extra provider-specific
}

const DataProvider = {
  getTasks(): Promise<Task[]>
  updateTaskStatus(id: string, status: Task['status']): Promise<void>
  createTask(task: Omit<Task, 'id'>): Promise<Task>
}
```

**Note:** Aggiungere tipo `Task` condiviso in `src/types/` se non esiste già.

---

### Task 3 — Refactor WebView per usare DataProvider

**Priorità:** Media  
**Dipendenze:** Task 2

Sostituisci tutte le chiamate dirette a `vscode.postMessage` e gli handler
`window.addEventListener('message', ...)` nella WebView con i metodi di `DataProvider`.

**Vincoli:**
- Nessun cambiamento visivo
- Solo refactor del layer dati
- I test esistenti (se presenti) devono continuare a passare

---

### Task 4 — LocalApiServer

**Priorità:** Alta  
**Dipendenze:** Task 1

Crea `src/server/LocalApiServer.ts`. HTTP server Node.js nativo (no express)
su porta configurabile (default 3333).

**Endpoint:**

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET` | `/` | Serve entry point HTML della WebView |
| `GET` | `/assets/*` | Serve asset statici (CSS, JS) |
| `GET` | `/tasks` | Ritorna array Task in JSON |
| `PATCH` | `/tasks/:id` | Aggiorna status del task |
| `POST` | `/tasks` | Crea nuovo task |

**Lifecycle:**
```typescript
// in extension.ts
export function activate(context: vscode.ExtensionContext) {
  const server = new LocalApiServer(repository)
  server.start(3333)
  context.subscriptions.push({ dispose: () => server.stop() })
}
```

**Note:** Usa il readonly repository esistente per leggere/scrivere task.
Aggiungi header CORS per permettere fetch da browser mobile.

---

### Task 5 — CSS Responsive Kanban

**Priorità:** Media  
**Dipendenze:** Task 1

Aggiungi breakpoint mobile al CSS esistente della WebView.

**Regole da applicare (max-width: 768px):**
- Colonne Kanban: layout a stack verticale
- Card: full-width
- Bottoni cambio stato: visibili senza hover (sempre mostrati)
- Font size: aumentato per leggibilità touch
- Touch target minimo: 44x44px per bottoni interattivi

**Vincolo:** Nessun cambio strutturale all'HTML. Solo CSS aggiuntivo.

---

### Task 6 — QR Pairing Panel

**Priorità:** Media  
**Dipendenze:** Task 4

Crea comando `agent-board.openMobileCompanion`.

**Comportamento:**
1. Rileva IP locale della macchina (interfaccia di rete attiva)
2. Compone URL: `http://<IP>:3333`
3. Genera QR code SVG con lib `qrcode` (no dipendenze native)
4. Apre WebView panel VSCode con QR + URL testuale come fallback

**UI del panel:**
```
┌─────────────────────────────┐
│  agent-board Mobile         │
│                             │
│  [QR CODE SVG]              │
│                             │
│  http://192.168.1.42:3333   │
│                             │
│  Scansiona con il telefono  │
│  (stesso WiFi)              │
└─────────────────────────────┘
```

**Aggiunta:** Mostra icona/comando vicino alla campanella ( tipo smartphone ) per accesso rapido al pairing. Aggiungi anche il numero di device connessi (dot come notifichenella campanella) e cliccando vede il dettaglio dei device connessi (IP, ultimo accesso). Indica anche quando il server è attivo o no (es. icona verde/rossa). (con toogle di attivazione/disattivazione server
)

**Dipendenza npm da aggiungere:**
```json
"qrcode": "^1.5.3"
```

---

### Task 7 — Test End-to-End

**Priorità:** Bassa (ma necessaria prima del merge)  
**Dipendenze:** Task 3, Task 4, Task 5, Task 6

**Checklist di verifica:**

- [ ] Server si avvia su `activate()` senza errori
- [ ] Server si ferma su `deactivate()` / chiusura VSCode
- [ ] QR panel mostra URL corretto con IP raggiungibile
- [ ] Browser mobile (iOS Safari + Android Chrome) carica la WebView
- [ ] Lista task visibile da mobile
- [ ] Cambio stato task funziona da mobile e si riflette in VSCode
- [ ] Creazione task da mobile appare nel Kanban desktop
- [ ] WebView desktop non regredisce dopo refactor DataProvider
- [ ] Nessun errore CORS nella console del browser

---

## Ordine di Esecuzione Consigliato

```
Task 1 (analisi)
    ↓
Task 2 (DataProvider) ──→ Task 3 (refactor WebView)
    ↓
Task 4 (LocalApiServer) ──→ Task 6 (QR Panel)
    ↓
Task 5 (CSS responsive)
    ↓
Task 7 (test e2e)
```

---

## Dipendenze NPM da Aggiungere

```json
{
  "qrcode": "^1.5.3",
  "@types/qrcode": "^1.5.5"
}
```

---

## Note Architetturali

- Il server HTTP è **locale** (no cloud, no tunnel): funziona solo su rete locale (stesso WiFi)
- Per uso remoto futuro si può valutare integrazione con `localtunnel` o `ngrok`, ma è out of scope
- La WebView mobile è **stateless**: lo stato canonico rimane nella extension
- Il polling per aggiornamenti real-time (es. quando un agente completa un task) può essere
  implementato con `GET /tasks` ogni N secondi — SSE o WebSocket sono un'evoluzione futura

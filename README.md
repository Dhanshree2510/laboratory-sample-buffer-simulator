# Laboratory Sample Buffer Simulator (Producer–Consumer)

A browser dashboard that simulates a lab where samples (blood, urine, tissue) are
collected by a **Producer** and processed by a **Consumer**, with a shared
**bounded buffer of capacity 5**. Synchronization is done with semaphores and a mutex
to handle **buffer overflow, buffer underflow and race conditions**.

No installation, no build, no dependencies.

## Run in VS Code (Go Live)
1. Unzip and open the folder in VS Code (`File → Open Folder`).
2. Install the **Live Server** extension (VS Code will suggest it automatically).
3. Click **Go Live** in the bottom-right status bar
   (or right-click `index.html` → *Open with Live Server*).
4. The dashboard opens at `http://127.0.0.1:5500`.

No Live Server? Run the task **"Serve simulator"** (`Terminal → Run Task`) and open
http://localhost:5500, or just run `python -m http.server 5500` in the folder.

## Dashboard
* **Flow diagram** – Producer → Shared Buffer (S101…S105 slots, IN/OUT pointers) → Consumer
* **Three condition cards** that light up live:
  1. **Buffer Full** – producer waits for an empty slot
  2. **Buffer Empty** – consumer waits for a sample
  3. **Race Condition** – mutex lock status, counter vs. real buffer contents
* Totals, occupancy-over-time chart and event log
* Controls: mode, number of producers/consumers, timings, speed, pause/resume
* One-click **scenarios** for every condition

## Modes
| Mode | Synchronization | Result |
|------|-----------------|--------|
| Safe | `empty` + `full` semaphores + mutex | Correct – producer/consumer block when needed |
| No mutex | semaphores only | Race condition – lost samples, counter drift |
| No semaphores | mutex only | Overflow and underflow – samples discarded |

## Tests (optional, needs Node.js)
`node tests/test.js`

## Files
```
index.html          dashboard
css/style.css       styling
js/sync.js          Semaphore and Mutex implementations
js/simulator.js     producer / consumer / buffer logic
js/app.js           dashboard rendering and controls
.vscode/            Live Server settings + fallback task
tests/test.js       automated tests
```

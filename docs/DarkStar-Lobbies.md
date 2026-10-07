# Under a Dark Star — Public Lobbies and Thrones

> Design and implementation plan for the public matchmaking system: a fixed pool of persistent
> lobbies ("thrones") whose seat is the reward for winning. Decided with Tom on 2026-09-29.
> Companion to `DarkStar-Design.md` (§2 round loop, §3 rules R1–R6, §5.2 continuity) and
> `DarkStar-Roadmap.md` phase P6, which this document expands and supersedes.
> T1–T4 are built (2026-10-03, §10.1–§10.4); T5 and T6 are not. Changelog at the end.

## 1. Goals

- **G1 — The throne is the prize.** The winner of a public round (the Hegemon who held the timer,
  or the challenger who landed the killing blow, R3/R4) is the Hegemon of that lobby's next round.
- **G2 — The winner shapes the next round.** They pick the map, and on special thrones the rules,
  from a menu that cannot break the game in the throne's favour.
- **G3 — A steady stream of games.** At any moment a player arriving at the site finds a lobby
  about to launch. The home page keeps advertising the lobbies closest to starting, as it does now.
- **G4 — Every public mode has a Hegemon.** FFA, team and special lobbies all run Hegemon rounds.
  Today only public FFA does.
- **G5 — No accounts required.** Anyone may sit on a throne. What an anonymous reign cannot have
  is history: high scores and profiles (S5, F13) wait for logins (P5).

Non-goals for the first version: cross-server thrones (one server, one pool), seats that survive
a server restart, ranked or skill-based matching, private lobbies (unchanged from P0).

## 2. Decisions

Numbered so the code and tests can cite them.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Fixed pool.** The server keeps a fixed number of persistent public lobbies, **thrones**, each running rounds back to back. Launch count **15**; the number is config, with a scaling rule available later (§9). **[Revised 2026-10-06 by L16: a floor of five per type, with thrones created and retired.]**                                                                  |
| L2  | **Fixed type per throne.** A throne is an FFA, team or special throne for its whole life. The mix is config (launch: 9 FFA, 3 team, 3 special). The winner chooses within the type, never the type.                                                                                                                                                                             |
| L3  | **No account needed.** The seat is keyed on the browser's `persistentID` (the localStorage UUID, or the JWT subject once P5 exists). Clearing storage or switching browsers loses a reservation. Bots are not a concern for now.                                                                                                                                                |
| L4  | **The winner's window.** On the win screen the winner has **30 s** (config) to pick the next map (and rules on a special throne) and to say whether they **stay** on the throne or **vacate** it. No answer: random map, seat opens. **[Revised 2026-10-06 by L23: no answer keeps the winner on the seat; only the map falls to random.]**                                     |
| L5  | **Vacating is allowed.** A winner may set the map and rules and then decline the seat.                                                                                                                                                                                                                                                                                          |
| L6  | **An open seat is first come, first served.** Any non-spectator in the lobby may claim an open seat, and may give it up again before the round starts. A seat nobody holds at start goes to the AI Hegemon (R6, already built).                                                                                                                                                 |
| L7  | **What the winner may set.** The map, from the full list. On a special throne, up to **two** modifiers from a whitelist (§5.4). Timer stays 20 minutes (R5), player cap is the map's, team count is the playlist's.                                                                                                                                                             |
| L8  | **Team thrones: the slayer takes the seat.** Not a team victory. The challenger who lands the killing blow (R3) holds the reservation; on a timer win the human Hegemon keeps it. Teammates get nothing beyond the win screen.                                                                                                                                                  |
| L9  | **Minimum to fire: two humans**, the seated Hegemon included, spectators excluded. A throne with fewer holds at zero and keeps its seat and map pick. A bot-held throne with one challenger does not start either.                                                                                                                                                              |
| L10 | **Countdown.** A throne's lobby opens the moment its round ends (during the winner's window, so players can gather). The countdown, **2 minutes** (5 s in dev), starts when the minimum is met and does not reset when it is met again after a dip.                                                                                                                             |
| L11 | **No reign cap.** A Hegemon may hold a throne indefinitely; losing on the timer is the intended fiction.                                                                                                                                                                                                                                                                        |
| L12 | **Restart opens every seat.** The registry lives in the master's memory. A deploy or crash reopens all thrones with the AI seated and reign counts at zero. Accepted because restarts will be rare once live; revisit with P5's database (§9).                                                                                                                                  |
| L13 | **Front page.** The existing three cards show the three thrones closest to starting. A **Thrones** tab lists every throne with its name, type, holder, reign count, player count, and a **Watch** button while a round runs (spectators, already built). **[Revised 2026-10-06 by L25: one card per line head.]**                                                               |
| L14 | **Named thrones.** Each throne has a fixed sci-fi name from a resource list, shown on its card, in the lobby and on the Dark Star panel. Cheap now, and the hook for reign identity later (F13).                                                                                                                                                                                |
| L15 | **Private lobbies unchanged.** The P0 flow (creator seats the throne, "New lobby" succession by hand, §6.22) stays as is. Thrones are public only.                                                                                                                                                                                                                              |
| L16 | **One launch line per type** (FFA, team, special), so players can seek the mode they prefer. Each line keeps a **floor of five** thrones gathering: when one launches, a new throne is created at the back. No ceiling: a line grows as rounds end and shrinks by culling (L20). Replaces L1's fixed pool. [2026-10-06]                                                         |
| L17 | **One countdown per line.** Only the head counts down: 2 minutes, started when the head has the minimum (not when it becomes head), held on a dip as in L10. A lobby that fills to the map's capacity fires at once wherever it stands. [2026-10-06]                                                                                                                            |
| L18 | **The head is the first throne in line that has met the minimum.** A throne with fewer humans keeps its place while the countdown passes it by. [2026-10-06]                                                                                                                                                                                                                    |
| L19 | **Order of the line.** The counting throne; then thrones that returned from a round with a human on the seat, by arrival (so a returning winner stands second behind a running countdown, and at the head when nothing is counting); then everything else by arrival. A round that ends for the AI, with no winner, or whose winner steps down joins the **back**. [2026-10-06] |
| L20 | **Culling.** When a line holds more than its floor and a throne in it has had no humans for the cull grace (60 s, see §10.5), that throne is retired and its lobby closed, last in line first. A throne with nobody in it holds no reign, so nothing is lost. [2026-10-06]                                                                                                      |
| L21 | **Joining a throne that is not the head is allowed**; the client shows its place in line. [2026-10-06]                                                                                                                                                                                                                                                                          |
| L22 | **The minimum stays two humans** (L9). It is the knob to raise once there is a population. [2026-10-06]                                                                                                                                                                                                                                                                         |
| L23 | **The window and the line.** A throne is out of line while its winner chooses; it enters when the choice is made or the window expires. **L4 is revised:** no answer means a random map and the winner **keeps the seat** by default; they may still give it up in the lobby before the round starts (L6). [2026-10-06]                                                         |
| L24 | **A throne's place is fixed when it enters the line.** Claiming or leaving a seat afterwards does not move it. Open to revision if it would help the flow of games. [2026-10-06]                                                                                                                                                                                                |
| L25 | **Launch with two lines, FFA and special.** The team line needs T5 (§5.9), which becomes the priority after this work. The home page shows one card per line head: two at launch. A line with nobody in it shows its first throne as waiting for players. [2026-10-06]                                                                                                          |
| L26 | **A running countdown is never interrupted.** A throne ahead of the head that regains the minimum is simply head next, with a full 2 minutes. A held throne's remaining time (L10) is its own only until another throne takes the countdown. [2026-10-06]                                                                                                                       |
| L27 | **After a round, the players who did not win choose:** stay with their throne, shown its place in line, or join the head of the line. [2026-10-06]                                                                                                                                                                                                                              |
| L28 | **Open thrones overtaken repeatedly by returning winners** is accepted for launch and watched; it needs a real population to occur. [2026-10-06]                                                                                                                                                                                                                                |

## 3. The throne model

### 3.1 Vocabulary

- **Throne** — a persistent public lobby slot: `throneID`, name, type (`ffa` / `team` / `special`),
  reign count, current holder, and the game it is currently running or gathering for.
- **Seat** — who plays the Hegemon in the throne's next round. Three states: **reserved** (the
  last winner has it until they answer or the window expires), **seated** (a human holds it, either
  a confirmed winner or a claimant), **open** (nobody; the AI takes it at start).
- **Reservation** — the winner's hold on the seat during the window (L4). It survives a reconnect
  and a page reload, since it is keyed on `persistentID`, but not a missed round.
- **Round** — one game on a throne, from lobby open to the winner vote.
- **Reign** — consecutive rounds the same `persistentID` has held the throne. A slayer starts at 1;
  a timer win adds 1; an AI or vacated seat resets it to 0.

### 3.2 State machine (per throne)

```
                       round ends (winner vote or void)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   ▼                                                                      │
 DECIDING ── winner picks & stays ──► GATHERING (seated) ──┐               │
 (30 s window,  ── winner vacates / ──► GATHERING (open)   ├─ ≥2 humans ─► COUNTDOWN ─► RUNNING
  lobby open)      window expires /                        │  (claim/unseat     (2 min,      (the game;
                   AI or no winner                         │   allowed)         holds at 0    spectators
                                                           │                    if < 2)       may join)
                                      claim / unseat ◄─────┘
```

- DECIDING and GATHERING are the same lobby; the seat state is what differs. The lobby is created
  the instant the previous round's result reaches the master, before the winner has answered.
- In COUNTDOWN a dip below two humans **holds** the lobby at zero (it does not start, does not
  cancel, keeps its pick); reaching two again resumes without resetting.
- A game that is voided (no winner vote, desync cancel, empty past timeout) ends the round with
  no winner: seat open, random map, reign 0.

### 3.3 Why not the existing queue

The scheduler today (`MasterLobbyService`) is **type-driven and disposable**: it keeps up to six
queued lobbies per type, starts a countdown on the front one every two minutes, and forgets a game
once it starts. A throne is **seat-driven and persistent**: it needs to remember who won, wait for
their pick, and reopen as the same named lobby. The queue's job (there is always a lobby about to
start) is met by the pool instead: with N thrones on a ~22-minute cycle (20-minute round plus
lobby time) the mean gap between launches is about 22/N minutes: 15 thrones ≈ 1.5 min, 30 ≈ 45 s.
The sort-by-soonest-start listing the home page uses already exists and stays.

## 4. Player-facing flow

1. **Home page.** Three cards, the thrones starting soonest (counting down first, then open thrones
   by player count). Each card: throne name, type, map, holder's name with a reign badge (or "Dark
   Star" for the AI), players / capacity, countdown or "waiting for players". A **Thrones** tab
   shows all fifteen, including running rounds with a Watch button.
2. **In the lobby.** The roster shows the **(Hegemon)** badge on the seat holder (P0's
   `LobbyPlayerView`). If the seat is **open**, every player sees a **Claim the throne** button; the
   holder sees **Give up the throne**. If it is **reserved**, the roster shows "reserved for
   <winner>" until they answer. The map and, on a special throne, the modifiers are shown once
   picked; before that, "The Hegemon is choosing…".
3. **Round.** Unchanged. The Dark Star panel shows the throne's name and the holder's reign.
4. **Win screen.** For the winner only, a **Next round** panel with a 30-second bar: a map picker,
   on special thrones a modifier picker (max two, whitelist), and two buttons: **Keep the throne**
   and **Step down**. Everyone else sees the lobby jump the existing `new_lobby` prompt already
   offers, plus the countdown (not started until two humans are present).
5. **Watch.** From the Thrones tab, joins the running game as a spectator (`GameServer` already
   converts late joiners to spectators; they take no slot).

## 5. Server design

### 5.1 ThroneRegistry (master)

New `src/server/ThroneRegistry.ts`, owned by the master and driven by `MasterLobbyService`. Pure
state plus transitions, no I/O, so it is unit-testable:

```ts
interface Throne {
  throneID: string; // stable, e.g. "throne-07"
  name: string; // from resources/thrones.json
  type: "ffa" | "team" | "special";
  reign: number;
  holder: { persistentID: string; name: string } | null;
  seat: "reserved" | "seated" | "open";
  reservationUntil?: number; // DECIDING only
  gameID: string | null; // the lobby or running game
  phase: "deciding" | "gathering" | "countdown" | "running";
  nextConfig: Partial<GameConfig>; // the winner's pick, merged on the lobby
}
```

Transitions: `roundEnded(throneID, result)`, `pickReceived(throneID, persistentID, pick)`,
`windowExpired(throneID)`, `seatChanged(throneID, seat)` (from the lobby), `gameStarted`,
`tick(now)` (expiries). Lives in memory (L12). The registry must be in the master because a
throne's successive games hash to different worker processes (`ServerEnv.workerIndex`).

### 5.2 Lobby type `throne`

- `PublicGameTypeSchema` gains `"throne"`. It is **not** added to `SCHEDULED_PUBLIC_GAME_TYPES`:
  thrones replace the ffa/team/special queues rather than joining them. At launch the master
  schedules **only** thrones; the old per-type queues stay in the code behind a config switch for
  the private playtest and as a fallback.
- `MasterLobbyService.maybeScheduleLobby` for thrones: on boot, create one lobby per open throne
  (AI seated, random map). Thereafter the registry says what each throne needs: a new lobby when a
  round ends, a `startsAt` when the count reaches two, a hold when it drops.
- The map playlist builds the base config per throne type exactly as today (`MapPlaylist.gameConfig`
  for `ffa` / `team`, `getSpecialConfig` for special) and the winner's pick is merged on top.

### 5.3 IPC additions (`IPCBridgeSchema.ts`)

Master → worker:

- `createGame` gains `throne?: { throneID, name, reign, heir?: { persistentID, name },
reservationUntil? }`. The worker passes `heir` to `GameServer.setHegemonHeir`, which already
  seats the heir when they join (`seatHeir`, P0).
- `updateLobby` gains `gameConfig?: Partial<GameConfig>` (the pick, applied through the same
  path as `ConfigPatch`), `heir?: string | null` (window expired or vacated: clear it) and
  `startsAt?: number | null` (null = hold).
- New `successorCreated { previousGameID, gameID }`: the finished game's worker calls
  `setSuccessorLobby`, which broadcasts `new_lobby` to everyone still on the win screen (exists).

Worker → master:

- New `throneRound { throneID, gameID, outcome: "overthrown" | "timer" | "void", winner?:
{ persistentID, name } }`, sent from `archiveGame` (the winner vote is resolved there; the
  archive record already carries `isHegemon`).
- New `thronePick { throneID, gameID, persistentID, gameMap?, modifiers?, stay }`, relayed from the
  finished game's socket (§5.5).
- `lobbyList` entries gain the throne fields (§7) and **include running throne games** (today only
  `GamePhase.Lobby` games are reported; `GameManager.publicLobbies` needs a running-thrones
  sibling) so the Thrones tab and Watch work.

### 5.4 The special-throne whitelist

Modifiers the winner may choose (from `MapPlaylist`'s `SPECIAL_MODIFIER_POOL`), max two, subject
to the existing `MUTUALLY_EXCLUSIVE_MODIFIERS`:

| Allowed at launch                                                                                                                                      | Held back pending a balance pass                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRandomSpawn`, `isCompact`, `isCrowded`, `isHardNations`, `startingGold1M`, `startingGold5M`, `goldMultiplier`, `isAlliancesDisabled`, `isPeaceTime` | `startingGold25M` (challenger rush), `isDoomsdayClock` (interacts with the round timer R4/R5), `isNukesDisabled` (removes the H19 punishment loop) |
| _Moot under a Dark Star, never offered:_ `isSAMsDisabled`, `isWaterNukes` (SAMs and silos are off, S6)                                                 |                                                                                                                                                    |

The whitelist is a constant next to the pool, with a test that every entry is in the pool. Tom's
rule: nothing that tilts the round toward the throne; the held-back column is reviewed after the
first public playtests (new follow-up in the design doc's §4).

### 5.5 The winner's pick

The win screen stays connected to the finished game's socket (the `new_lobby` prompt relies on
this today). The client sends a new `throne_pick` message on that socket; `GameServer` accepts it
only from the client whose `persistentID` equals `winnerPersistentID()`, only once, only within
the window, and forwards it to the master as `thronePick`. The master validates the map and
modifiers against the whitelist, updates the registry, and sends `updateLobby` (config and, on
vacate, `heir: null`) to the successor's worker. The window timer runs in the master
(`reservationUntil`); expiry sends the same `updateLobby` with a random map.

### 5.6 Claiming and leaving the seat

New lobby messages `claim_seat` and `leave_seat` on the lobby socket. `GameServer` grants a claim
when the lobby has not started, the sender is not a spectator, the seat is open and no reservation
is live. It sets `gameConfig.hegemon.seat = clientID`, the same field P0's creator seat uses, so
`start()` stamps `isHegemon` unchanged and `reconcileHegemonSeat` still unseats a leaver. Seat
changes are reported to the master in `lobbyList`.

### 5.7 Minimum to fire and the hold

Today the master sets `startsAt` once and `GameManager.tick` prestarts any game past it with at
least one client. For thrones the **master** owns the count: it sets `startsAt` only when the
worker reports two non-spectator clients, and sends `startsAt: null` when the count drops below
two before start. `GameServer.setStartsAt(undefined)` returns the game to `GamePhase.Lobby`
(`phase()` treats a missing `startsAt` as "lobby" while not started). The lobby card shows
"waiting for players" during a hold.

### 5.8 Round end → next lobby

1. `archiveGame` in the worker sends `throneRound` (winner from the vote; outcome from the record:
   `isHegemon` winner = `timer`, other player = `overthrown`, no winner = `void`).
2. The master updates the registry (holder, reign, seat `reserved` or `open`), creates the successor
   lobby immediately via `createGame` (random map placeholder, `heir` when reserved), and sends
   `successorCreated` to the old game's worker.
3. The old game broadcasts `new_lobby`; the winner's client opens the pick panel; everyone else
   gets the jump prompt.
4. The pick or the expiry lands as `updateLobby` on the new lobby.

### 5.9 Team thrones (core work)

The sim gates the throne on FFA (`hegemonSeat` in `GameServer.start()`, `Config` disabling the
mode otherwise, the playlist's `hegemon: mode === FFA`). A team throne needs, in `src/core`:

- The Hegemon is its **own one-player team** (no allies, H9 already), placed outside the
  `playerTeams` count so team assignment ignores it.
- `WinCheckExecution`'s team win check defers to the Hegemon check: overthrow and timer are the
  only round ends (R1), so the ordinary team-tile win is disabled under a Dark Star.
- Team donation toggles (gold and troops on by default in team games) do not touch the throne: H9
  governs its donations both ways (troops to and from the Hegemon ignore the toggle; gold is closed).
- Nation and Tribe behaviour toward the Hegemon is team-agnostic already (design doc §3.2 H11: the nation target search passes over the Hegemon).

This is the largest engineering item and ships last (§10, T5). Until then team thrones are not in
the mix.

### 5.10 Identity

`persistentID` is the key everywhere and is **never broadcast**: registry, reservations, the pick
check. What clients see is the holder's last username, captured at round end. With P5, the JWT
subject replaces the UUID in the same field with no registry change (L3).

## 6. Client design

- **Schemas** (`src/core/Schemas.ts`): `PublicGameInfoSchema` gains the throne fields (§7);
  `GameInfoSchema` (lobby info) gains `throne` and the seat state; new client messages
  `throne_pick`, `claim_seat`, `leave_seat`; zbin encodings follow the schemas (`ZbinWire.ts`).
- **Home page** (`LobbyCard.ts`, `GameModeSelector.ts`, `DetailedGameViewModal.ts`): throne name
  and holder line; sort rule of L13; a **Thrones** tab reusing `DetailedGameViewModal` with running
  rounds and a Watch button that enters the existing spectator join (`JoinLobbyModal`
  `enterLobbyFromInput(spectator = true)`).
- **Lobby** (`JoinLobbyModal.ts`, `LobbyPlayerView.ts`): the P0 seat badge; Claim / Give up buttons
  gated on seat state; "reserved for <name>" and "The Hegemon is choosing…" states.
- **Win screen** (`WinModal.ts`): the Next-round panel for the winner (map picker reused from the
  host modal's picker, modifier chips on special thrones, Keep / Step down, 30-second bar). Sends
  `throne_pick`. Everyone else gets a **Join Next Round** button beside Exit and Spectate.
- **HUD**: throne name and reign on the Dark Star panel.
- All strings through `translateText` with keys in `resources/lang/en.json` (`throne.*`).

## 7. Wire and schema summary

| Where                          | Addition                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `PublicGameTypeSchema`         | `"throne"` (not scheduled by the old queue)                                                                                 |
| `PublicGameInfoSchema`         | `throne?: { throneID, name, type, reign, holderName?, seat: "reserved" \| "seated" \| "open", running?: true, startedAt? }` |
| `GameInfoSchema`               | `throne?` as above, plus `reservationUntil?` for the "choosing" state                                                       |
| Client → server (game socket)  | `throne_pick { gameMap?, modifiers?, stay }`                                                                                |
| Client → server (lobby socket) | `claim_seat {}`, `leave_seat {}`                                                                                            |
| Server → client                | existing `new_lobby`; lobby info carries seat and throne state                                                              |
| IPC master → worker            | `createGame.throne`, `updateLobby.{gameConfig, heir, startsAt: null}`, `successorCreated`                                   |
| IPC worker → master            | `throneRound`, `thronePick`, `lobbyList` entries with throne fields and running games                                       |
| Resources                      | `resources/thrones.json`: ordered list of throne names (≥ 60)                                                               |

## 8. Edge cases

| Case                                                            | Behaviour                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Winner closes the tab before picking                            | Window expires: random map, seat opens, reign 0.                                                                                                |
| Winner picks and stays, then leaves the lobby                   | `reconcileHegemonSeat` unseats them; the reservation stands until start, so returning reseats them. Absent at start: AI holds it (P0's answer). |
| Winner is the AI (timer with an AI Hegemon, or an AI slayer)    | No reservation; seat open; random map; reign 0.                                                                                                 |
| Winner is a human Hegemon on the timer                          | Reservation for the same person; reign + 1 on stay.                                                                                             |
| Round is void (no vote, desync cancel, empty timeout)           | As "AI winner". The throne is never stuck: the registry's tick reopens it if a game vanishes without `throneRound`.                             |
| Two people claim an open seat at once                           | First message the server handles wins; the second gets the updated lobby info.                                                                  |
| Claimant disconnects                                            | Unseated (existing reconcile); seat open again.                                                                                                 |
| The same `persistentID` reserved on throne A claims on throne B | Allowed. A's reservation lapses when A starts without them. No cross-throne enforcement in v1.                                                  |
| Count drops below two during countdown                          | Hold at zero, pick kept; resume without reset when two again (L9/L10).                                                                          |
| Seated human Hegemon + one challenger                           | Fires (two humans).                                                                                                                             |
| Server restart                                                  | All thrones reopen: AI seated, reign 0, random maps (L12).                                                                                      |
| Invalid pick (map not in list, modifier off the whitelist, > 2) | Rejected; the client's picker cannot produce it, so treat as a protocol error and fall back to random.                                          |
| Late joiner after start                                         | Becomes a spectator (existing). A spectator can never claim a seat.                                                                             |
| Coordinated mode (`LobbyCoordinatorClient`)                     | Thrones are local-mode only. The coordinator is API-side and P5 deletes it.                                                                     |

## 9. Configuration

| Constant               | Launch value | Dev value | Notes                                                                        |
| ---------------------- | ------------ | --------- | ---------------------------------------------------------------------------- |
| `THRONE_FLOOR`         | 5            | 2         | L16; thrones each line keeps open (FFA and special lines; team waits for T5) |
| `THRONE_CULL_GRACE_MS` | 60 000       | 15 000    | L20; how long a surplus throne must be empty before it is retired            |
| `THRONE_COUNTDOWN_MS`  | 120 000      | 5 000     | L10                                                                          |
| `THRONE_MIN_PLAYERS`   | 2            | 2         | L9 (humans, spectators excluded)                                             |
| `WINNER_WINDOW_MS`     | 30 000       | 30 000    | L4                                                                           |
| `THRONE_MAX_MODIFIERS` | 2            | 2         | L7                                                                           |
| Round timer            | 20 min       | —         | R5, not choosable                                                            |

**Scaling rule [superseded 2026-10-05 by the launch lines, L16-L20]:** `open = clamp(floor(online / PLAYERS_PER_THRONE), THRONE_COUNT,
THRONE_COUNT_MAX)` where `online` is home-page lobby-socket clients plus in-game clients (workers
already report `liveGames`; add a client count). Thrones beyond `open` go dormant after their
current round ends and wake in name order when needed. Off at launch: the count is simply 15.

## 10. Implementation order

| Step | Scope                                                                                                                                                                     | Size |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T1   | `ThroneRegistry` + master scheduling of FFA thrones with the AI seated: named lobbies back to back, min-to-fire hold, random maps, running games in the list, restart.    | M    |
| T2   | The seat: `throneRound` from `archiveGame`, reservation and window, `throne_pick` (map, stay / step down), `claim_seat` / `leave_seat`, heir seating, `successorCreated`. | M    |
| T3   | Client: throne cards, Thrones tab with Watch, lobby seat buttons and states, win-screen Next-round panel, Dark Star panel name and reign.                                 | M    |
| T4   | Special thrones: whitelist, modifier picker, validation tests.                                                                                                            | S    |
| T5   | Team thrones: core changes of §5.9 with tests, then add them to the mix.                                                                                                  | L    |
| T6   | Scaling rule and telemetry (launches per minute, mean wait, hold time, seats claimed vs AI).                                                                              | S    |

T1–T4 can ship to the private playtest server; T5 gates team thrones only.

### 10.1 As built: T1 (2026-10-03)

What exists, and where it departs from the plan above:

- **`src/server/ThroneRegistry.ts`** is the pure state machine of §5.1, driven by
  `MasterLobbyService`. It has no clock and no I/O: each scheduling pass hands it the time and a
  map of what the workers reported per game (`numPlayers`, `running`) and it answers with actions
  (`create`, `countdown`, `hold`). Phases in T1 are `gathering`, `countdown`, `running`; the
  `deciding` window arrives with T2. The seat is always `open` and the reign 0 until T2.
- **Mode switch.** Thrones are the default everywhere, `npm run dev` included. `PUBLIC_LOBBIES=queue`
  restores the per-type queues (the fallback of §5.2). The master builds the registry from the
  environment (`throneRegistryFromEnv`): `THRONE_COUNT` (15 prod / 3 dev), `THRONE_MIN_PLAYERS`
  (2; set 1 to smoke-test a throne alone in dev, Tom's choice), `THRONE_COUNTDOWN_MS` (2 min / 5 s).
  The mix is all FFA until T4 and T5 add the other types.
- **The hold (§5.7) keeps the remaining time.** A dip below the minimum withdraws the worker's
  `startsAt` (`updateLobby` with `startsAt: null`) and stores what was left; reaching the minimum
  again resumes with that remainder, zero if the countdown had already run out. The worker guards
  the same rule itself: a throne lobby's `phase()` stays `Lobby` past `startsAt` while under the
  minimum (`GameServer.throneHeld`), covering the second before the master's hold lands.
- **Counting humans.** Worker reports gained `numPlayers` (connected non-spectators) beside
  `numClients`; the master counts the former.
- **Round end.** `archiveGame` calls the new `GameServerDeps.throneRound` hook, which the
  `GameManager` routes to `WorkerLobbyService` and on to the master as `throneRound`. Outcomes are
  `timer` (the seated player won), `overthrown` (another player won), **`ai`** (a nation won; the
  server cannot tell an AI Hegemon holding the timer from an AI slayer, and T1 needs no
  distinction) and `void` (no winner). The master opens the successor at once and sends
  `successorCreated` to the finished game's worker, which broadcasts the existing `new_lobby`.
- **Vanished games.** A throne whose game is missing from every worker report for 10 s
  (`DEFAULT_VANISH_GRACE_MS`) is recycled as a void round. This covers a lobby reaped empty by the
  3-hour cap, a worker crash and a game that ended without a vote.
- **Stale reports.** A finished round stays in its worker's report while players sit on the win
  screen; the master advertises only the registry's current game per throne.
- **Lobby list.** Running throne rounds are reported (`throne.running`, `startedAt`) and sort
  last; open thrones sort countdown first, then by players waiting, then by name (L13).
- **Client shim (T3 does the rest).** The three home cards show the three thrones closest to
  starting, named in the subtitle (`throne.card_subtitle`), "Waiting for players" instead of a
  countdown while gathering. The lobby browser has a plain **Thrones** pane listing every throne;
  a running round reads "In progress" and is not clickable. No Watch, no holder line, no seat
  buttons, nothing on the Dark Star panel yet.
- **Names.** `resources/thrones.json`: 80 real star names (Tom: invented names may come later).
- **Tests.** `tests/server/ThroneRegistry.test.ts` (15), `MasterLobbyServiceThrones.test.ts` (8),
  `WorkerLobbyServiceThrones.test.ts` (6), `ThroneGame.test.ts` (7). The wire snapshot gained the
  optional `throne` field.

### 10.2 As built: T2 (2026-10-03)

The seat, server side. Nothing in the browser sends these messages yet (T3), so the only
observable behaviour under `npm run dev` is the expiry path: a human winner's seat is reserved for
30 s and then opens.

- **Registry.** `ThroneRegistry` gained the `deciding` phase and the seat fields of §5.1 (`heir`,
  `reservationUntil`, `pendingReign`, `previousGameID`). `roundEnded` with a human winner
  (`timer` or `overthrown`) reserves the seat and opens the successor at once with the heir in
  its assignment; an `ai` or `void` round opens the seat. `pickReceived` accepts the answer only
  from the heir, only from the game they won, only inside the window, and only once; it returns a
  `pick` action (map, heir or null, reign). `observe` expires the window on the master's clock
  (`expire` action) and **does not count down while deciding**, so a round cannot start under a
  map the winner has not picked (the dev countdown is shorter than the window).
- **Reigns (§3.1).** `pendingReign` is 1 for a slayer and for a claimant who held the timer, and
  `reign + 1` for the sitting holder who held it; it becomes the reign on "stay". Step down,
  expiry, AI and void reset to 0. The registry never learns who claimed a seat in the lobby (it
  does not need to: their first timer win makes them the holder).
- **IPC.** `createGame.throne` carries `heir` and `reservationUntil`. `updateLobby` carries
  `gameConfig` (the pick's `gameMap` and a `maxPlayers` recomputed for it through the new
  `MapPlaylist.maxPlayersForMap`) and `throne: { heir, reign }`; its `startsAt` is now optional.
  Worker → master `thronePick { throneID, gameID, persistentID, gameMap?, stay }`. The master
  checks the map against the full `GameMapType` list; an unknown name keeps the random map and
  the stay/leave answer (§8).
- **GameServer.** `setThrone` seats the heir on arrival through P0's `seatHeir`. `updateThrone`
  applies the master's answer: a null heir unseats a heir who had already sat down and lets
  anyone claim. `claim_seat` / `leave_seat` are **intents** (lobby-phase, like
  `toggle_game_start_timer`), authorized for any websocket player before start, and granted when
  the lobby is a throne's, the sender is not a spectator, the seat is empty and no heir stands;
  a heir who leaves the seat gives up the reservation too. `throne_pick` is a client **message**
  on the finished game's socket, accepted from the winner only and once. The pick's config lands
  through `applyThronePick` (map and cap), not the host's config-patch path, which deliberately
  excludes `maxPlayers`. Lobby info's `throne` now carries `holderName`, the seat state
  (`seated` when a seat is set, `reserved` while a heir stands, else `open`) and
  `reservationUntil` while the window is open.
- **Config.** `THRONE_WINDOW_MS` (30 s).
- **Tests.** `tests/server/ThroneSeatClaim.test.ts` (12: claims, refusals, the heir, isHegemon at
  start, the pick), plus seat cases added to `ThroneRegistry` (9), `MasterLobbyServiceThrones` (4)
  and `WorkerLobbyServiceThrones` (3).

### 10.3 As built: T3 (2026-10-03)

The client side of §4 and §6, plus the one server addition it needed.

- **The window reaches the win screen.** `successorCreated` carries `reservationUntil`, and the
  finished game's `new_lobby` broadcast gained `throne: { reservationUntil }`. That is how the
  winner's client learns both the successor's id and how long it has.
- **`src/client/ThroneState.ts`** keeps, per join, the throne from the last lobby info (the HUD
  needs it after start, when lobby info stops). The win modal itself remembers whether this
  client won the round.
- **Transport** gained `ClaimSeatEvent`, `LeaveSeatEvent` (sent as the `claim_seat` /
  `leave_seat` intents) and `SendThronePickEvent` (the `throne_pick` message); `NewLobbyEvent`
  carries `reservationUntil`.
- **Lobby** (`JoinLobbyModal`, `LobbyPlayerView`): the throne row shows "Throne of <name>", the
  holder (the seated player, "Reserved for <winner>" while they choose, or the AI), the reign when
  above zero, and one button: **Claim the throne** on an open seat, **Give up the throne** for the
  holder; spectators get none. The footer reads "The Hegemon is choosing…" while the window is
  open.
- **Win screen** (`WinModal`): for the winner, on the new-lobby announcement, a **Next-round**
  panel: the throne's name, a bar and seconds counting down to the window's end, the map picker
  (the host modal's `map-picker`, Random selected by default), **Keep the throne** / **Step
  down**. Either answer sends the pick and jumps to the new lobby a moment later. If the window
  passes first, the panel says so and offers **Join the next round**. Everyone else gets a
  **Join Next Round** button in the same window, beside Exit and Spectate (the window reopens if
  they had dismissed it to spectate); the host is sent straight to the new host view. The separate
  top-of-screen join prompt was folded into the win screen on 2026-10-04.
- **Cards** (`LobbyCard.throneCardSubtitle`): "<throne> · <mode> · <holder>", the holder being
  "<name> · reign N", "Reserved for <name>" or "Dark Star". Used on the home cards and in the
  lobby browser.
- **Thrones pane and Watch**: a running round's card reads **Watch** and joins the game as a
  spectator (`join-lobby` with `spectator: true`). A separate home-page tab was not added: the
  lobby browser's Thrones pane is the Thrones tab of L13.
- **Dark Star panel**: a line under the title, "Throne of <name>" or "Throne of <name> · reign N",
  for public throne rounds only.
- **Tests.** `tests/client/components/LobbyPlayerView.throne.test.ts` (5), plus the window on
  `new_lobby` / `successorCreated` in the worker and master throne tests. The win-screen panel and
  the modal footer are checked by hand in the browser (Tom's Stage 2 pass).

### 10.4 As built: T4 (2026-10-03)

Special thrones: the pool has them, and their winners set up to two modifiers.

- **The whitelist lives in `src/core/ThroneModifiers.ts`**, shared by the server (validation) and
  the client (the chips): the nine allowed keys of §5.4, `THRONE_MAX_MODIFIERS = 2`, and the one
  exclusive pair inside the whitelist (the two starting-gold amounts). `validateThroneModifiers`
  rejects anything off the list, repeated, in excess or exclusive, and the master then keeps the
  rolled set (§8). Tests check the whitelist is a subset of the playlist's pool and that its
  exclusive pairs match the playlist's table.
- **The mix.** `THRONE_SPECIAL_COUNT` (3 in production, 1 in dev) special thrones; the rest FFA
  until T5. A special throne's lobby rolls a special game pinned to FFA (`MapPlaylist.gameConfig`
  took a `mode` option), since the Hegemon is FFA only.
- **The pick.** `throne_pick` carries `modifiers` (schema-checked against the whitelist and the
  cap). The master rebuilds the round with `MapPlaylist.throneSpecialConfig(map, modifiers)`: the
  special builder run with an explicit modifier set, no roll, no map-forced modifiers, no random
  fallback, the map's own disabled modifiers still honoured, not counted toward the trusted
  rotation. A winner who picks only a map keeps the lobby's rolled modifiers (`modifierKeysOf`).
  The worker takes the whole rebuilt round through `applyThronePick`, whose allowlist
  (`THRONE_PICK_KEYS`) covers everything the playlist derives from the map and the modifiers and
  nothing of the lobby's identity; keys the new set lacks are cleared.
- **Client.** On a special throne the Next-round panel shows one chip per whitelisted modifier,
  at most two on, an exclusive counterpart greyed out; none chosen keeps the rolled set.
- **Tests.** `tests/server/ThroneModifiers.test.ts` (10), and special-throne cases added to the
  master, worker and seat tests.

### 10.5 As built: the launch lines, server side (2026-10-06)

L16-L20, L23, L24 and L26 in the master; the client (L21, L25, L27) is not built yet.

- **Registry.** `ThroneRegistry` keeps a dynamic set of thrones instead of a fixed pool. A
  throne is in line while `gathering` or `countdown`; `line(type)` orders them (the counting
  throne, then `priority` thrones by `enteredSeq`, then the rest) and `placeOf` gives the
  1-based place. `observe` runs four steps: each throne's window, lobby and report; each
  line's one countdown; the floor (`addThrone` + `create` at the back); the cull (`retire`
  action). Options: `floor` per type replaces `count` and `mix`; `cullGraceMs` is new.
  Throne ids count up and are never reused; names are handed out in list order and reused
  once the thrones that carried them are gone.
- **The window (L23).** `resolveWindow` serves both the winner's answer and the expiry, which
  is now the same as "keep the throne" with no map: the `expire` action is gone and the
  master sends the ordinary pick update with the heir kept. Staying enters the line with
  `priority`; stepping down, an AI round and a vanished game enter at the back. A lobby that
  vanishes while its throne is in line is recreated in place.
- **The meter (L26).** A new countdown clears every other throne's held `remainingMs` in that
  line, so two launches cannot follow each other on leftover time.
- **Culling (L20).** A throne's `emptySince` is tracked while in line. Tom agreed to reuse the
  vanish grace, but 10 s would retire a returned throne while its players are still on the
  win screen, so culling has its own grace: `THRONE_CULL_GRACE_MS`, 60 s (15 s in dev). The
  master forwards `retire` as `updateLobby { retire: true }`; `GameServer.retire()` ends an
  unstarted lobby, which the manager then prunes. A started round is never retired.
- **Capacity (L17).** Nothing to build: a worker's lobby already leaves the lobby phase when
  it reaches `maxPlayers`, with or without a countdown.
- **The public list.** `ThroneInfo` gains `place` (optional, wire-compatible). The master sets
  it on each advertised throne from the registry and sorts by it: each line's head first, FFA
  before special at the same place, deciding thrones next, running rounds last.
- **Config.** `THRONE_FLOOR` (5, dev 2) replaces `THRONE_COUNT` and `THRONE_SPECIAL_COUNT`.
- **Tests.** `ThroneRegistry.test.ts` rewritten (33: the earlier behaviour plus the head, the
  order, the floor, the cull, names); `MasterLobbyServiceThrones.test.ts` (18: launch order
  with places, the retire message, the expiry keeping the heir);
  `WorkerLobbyServiceThrones.test.ts` gains the retire case.
- **Still to build (client).** Two home cards, one per line head, with "next" or "N ahead";
  the Thrones tab in line order; the lobby's own place display; the win screen's "stay with
  this throne (Nth in line)" and "join the head" buttons (L27); sending a player whose
  throne was retired under them to the head; the rulebook's line about launches.

## 11. Tests

- `tests/server/ThroneRegistry.test.ts`: every transition of §3.2; reservation expiry; vacate;
  claim rules; void rounds; restart state; the scaling clamp.
- `tests/server/MasterLobbyServiceThrones.test.ts`: boot creates `THRONE_COUNT` lobbies; a round
  end creates the successor before the pick; `startsAt` only at two humans; hold and resume.
- `tests/server/ThronePick.test.ts`: only the winner, only once, only in the window; whitelist and
  exclusivity; vacate clears the heir.
- `tests/server/ThroneSeatClaim.test.ts`: claim / leave; spectators refused; reserved seat refused;
  `start()` stamps `isHegemon` from a claimed seat.
- `tests/server/WorkerLobbyServiceThrones.test.ts`: running thrones reported with throne fields.
- Schema round-trips for the new messages (`GameServerWire` pattern).
- Core (T5): team-mode Hegemon as its own team; win check under a Dark Star in team mode.

## 12. Open questions

- **Q1 — Dormant thrones and the mix.** Superseded 2026-10-05 by the launch queues (§13): only
  the head of each type's queue is ever active, so nothing needs waking.
- **Q2 — Reign display for the AI.** Show the AI's consecutive holds as a reign ("the Dark Star
  has held Cygnus for 4 rounds") or always 0? (Suggest: show it; it invites a challenger.)
- **Q3 — Held-back modifiers.** Review the second column of §5.4 after the first public playtests.
- **Q4 — Persisting seats** once P5's database exists: reservations and reign counts survive a
  restart (L12 revisited).

## 13. Direction (2026-10-05): launch queues per type [Decided 2026-10-06 as L16-L28; server side built, §10.5]

Tom's notes from the evening of 2026-10-05, written up so the decisions can be numbered next
session. Nothing here is built; §2 still describes what runs today.

**The problem.** OpenFront's scheduler has one property that makes its public games work with
any population: there is always exactly one lobby about to start, so players converge on it.
The throne pool dropped that property because a throne has to wait for its winner (§3.3). As
built, every throne runs its own countdown the moment it has two humans, so with fifteen
thrones and ten players the result is five thin rounds instead of one good one. (In dev the
countdown is 5 s, which makes this look worse than production's 2 minutes, but the scattering
is real at either setting.) A round of two is legal and should stay legal; it is just a poor
experience for both, so launches need metering that consolidates players into fewer, fuller
rooms without breaking the seat-driven, round-to-round throne.

**The model.** Per game type (FFA, team, special: players should be able to seek the mode they
prefer), a **launch queue** of gathering thrones:

1. **Floor of five.** Each type's queue holds at least five thrones. When the head launches,
   a fresh throne is created at the back to restore the floor (names from `thrones.json`,
   80 of them). There is no fixed ceiling: the queue grows as rounds end and shrinks by
   culling (rule 5).
2. **Only the head counts down.** The 2-minute countdown runs on the head once it has the
   minimum two humans and fires at zero; it holds at zero on a dip, as today. A throne
   anywhere in the queue that reaches the map's capacity fires at once.
3. **The head is the first throne in line that has met the minimum.** A throne with fewer
   humans keeps its place while the countdown passes it by, so a single waiting player never
   blocks a populated throne behind them. The home page steers people to the head.
4. **Returning rounds.** A round that ends with a human on the seat (the winner kept it, or a
   claimant took it in the window) re-enters the queue in **second place**: behind a head
   whose countdown is already running, at the head if nothing is counting down. Several
   returning winners order by arrival. A round that ends with the seat open or AI-held goes to
   the **back**. Reasoning (Tom): a fresh winner must not be punted behind a line that fires
   once every two minutes, but neither may they interrupt a countdown others are already
   watching.
5. **Culling.** When a type's queue holds more than five thrones and one of them has no humans
   at all, it is retired. Because new thrones are only ever created to restore the floor, the
   surplus is always returned rounds nobody stayed for, so nothing of value is lost: a throne
   with zero humans holds no reign. Culling uses the registry's existing vanish grace, so a
   player mid-join is moved to the head rather than dropped.

**What it changes.** L1's fixed pool of fifteen immortal thrones becomes a floor of five per
type with creation and retirement; L12's "restart opens every seat" still holds; L13's home
page shows the three heads, and the Thrones tab lists what exists, head first, each with its
place in line. §9's deferred scaling rule and Q1 (dormant thrones) are superseded: with few
players only the three heads are ever active, and the rest wait in line. The Stage 6 "throne
count" item in `DarkStar-Launch.md` is replaced by this work; Tom's opening numbers are
5 / 5 / 5 (team thrones still wait on T5, §5.9).

**Player-facing consequences to design with it.** The win screen can say exactly where the
winner stands ("Your throne is second in line for the FFA queue"); a throne card shows "next"
or "N ahead"; joining a throne that is not the head is allowed and says so.

**Open for tomorrow (L16 onward).** The numbering of the rules above; whether the floor (5)
and the minimum (2) stay separate config values (`THRONE_COUNT` becomes a per-type floor;
`THRONE_MIN_PLAYERS` unchanged); the dev values (floor 1 per type, 5 s countdown); what the
home page's three cards do when a type's head has nobody; the win-screen and Thrones-tab
strings; the registry changes and tests (`ThroneRegistry` stays pure: the queue is an ordering
over the existing gathering state, plus `create` / `retire` actions).

## 14. Changelog

- **2026-09-29** — Created from Tom's outline and answers: fixed pool of 15 named thrones, fixed
  type per throne, no accounts, 30-second winner window with map and rules pick and the option to
  step down, first-come open seats, AI fallback, two humans to fire with a hold, no reign cap,
  restart opens every seat, three cards plus a Thrones tab, private lobbies unchanged.
- **2026-10-03** — **T1 built** (§10.1): `ThroneRegistry`, master scheduling of FFA thrones with
  the AI seated, the hold that keeps its remaining time, `throneRound` / `successorCreated` IPC,
  running rounds in the lobby list, a thin client shim. Tom's decisions of the day: the Thrones
  tab, Watch and the seat buttons wait for T3; `THRONE_MIN_PLAYERS` may be overridden to 1 for a
  solo smoke test in dev; throne names are real stars for now. A fourth round outcome, `ai`, was
  added to §5.3's `throneRound` because the server cannot tell an AI Hegemon's timer win from an
  AI slayer.
- **2026-10-03** — **T2 built, server side** (§10.2): reservation and window, `throne_pick`,
  `claim_seat` / `leave_seat` as intents, heir seating and unseating, reigns, the pick merged
  with a recomputed player cap. Two refinements of the plan: no countdown while the winner is
  choosing; a heir who leaves the seat in the lobby gives up the reservation. T3 brings the UI.
- **2026-10-03** — **T3 built** (§10.3): the client. Cards with the holder, Claim / Give up and
  "reserved for" in the lobby, the winner's Next-round panel on the win screen with the map
  picker and the 30-second bar, Watch from the Thrones pane, the throne and reign on the Dark
  Star panel. One wire addition: `new_lobby` carries the window (`throne.reservationUntil`).
- **2026-10-03** — **T4 built** (§10.4): special thrones in the pool (3 prod / 1 dev), the
  modifier whitelist shared by server and client, the winner's modifier chips, the round rebuilt
  from the pick. Q3 (the held-back modifiers) stays open for the first public playtests.
- **2026-10-05** — **Direction set for launch queues** (§13, proposed): per-type queues with a
  floor of five thrones, only the head counts down, the head is the first throne that has met
  the minimum, returning rounds with a seated human enter second, open or AI rounds go to the
  back, surplus empty thrones are culled with the vanish grace. Supersedes L1's fixed pool,
  §9's scaling rule and Q1. Decisions to be numbered L16 onward.
- **2026-10-06** — **Launch lines decided (L16-L28) and built on the server** (§10.5). Tom's
  answers of the day: joining a throne that is not the head is allowed; the countdown starts
  when the head has the minimum; the minimum stays two; launch with FFA and special lines,
  team thrones next; a throne enters the line only when the winner's window resolves, and an
  unanswered window now keeps the winner on the seat (L4 revised); place is fixed at entry; a
  running countdown is never interrupted; players who did not win may stay with their throne
  or join the head; repeated overtaking of open thrones is accepted for now; one home card per
  line head. One deviation recorded in §10.5: culling uses its own 60-second grace, not the
  10-second vanish grace.

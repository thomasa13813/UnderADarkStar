# Under a Dark Star — Sound

The ledger of every sound in the game: what plays, when, who hears it, where the
file came from, and what is still to do. Kept current as sounds change; the
workflow in §6 says how a new one gets in. Companion to the design doc's S8
(`docs/DarkStar-Design.md`) and the roadmap's P4.

## 1. The short answers

- **Nothing inherited needs scrubbing before release.** Every effect and
  ambience file came in through OpenFront's own commits under `resources/`,
  which `LICENSE-ASSETS` places under CC BY-SA 4.0, and `CREDITS.md` attributes
  them. OpenFront's proprietary audio (menu theme, gameplay music, the lobby
  start alert) lived in their closed `proprietary/` folder and was never in this
  repository; the paths that pointed at it were given silent placeholders on
  2026-09-27 and the music ones replaced on 2026-10-12.
- **What is ours:** the five soundtrack tracks, the three cues of
  2026-10-04 (`launch`, `landing`, `missile`) and the fleet cue of 2026-10-12
  (`invasion.mp3`, under the `transport-ship` key). All CC BY-SA with the
  rest of `resources/`.
- **One placeholder remains:** `game-start-alert.mp3`, the lobby bell, is a
  silent file.
- **Sound is off by default on the web** (master starts at 0 until a player
  touches any audio slider). When testing, open the audio settings once.

## 2. Where things live

| What                       | Where                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Files                      | `resources/sounds/{music,effects,ambience}/`                                         |
| Cue registry               | `src/client/sound/Sounds.ts` — cue name → file → mixer channel                       |
| Who hears what             | `src/client/controllers/SoundEffectController.ts` (in-game), `OpeningController.ts`  |
| Ambience                   | `src/client/controllers/AmbienceController.ts` — zoomed in near a structure          |
| Music                      | `src/client/sound/Soundtrack.ts` — the track list and the player                     |
| Channels, budgets, volumes | `src/client/sound/AudioMixer.ts`; per-channel sliders in the settings' Audio tab     |
| HUD cues                   | `hud/layers/ActionableEvents.ts`, `EventsDisplay.ts`, `WinModal.ts`, `RadialMenu.ts` |
| Lobby bell                 | `src/client/JoinLobbyModal.ts`                                                       |
| Credits                    | `CREDITS.md`                                                                         |

Channels: **master**, **music**, **effects**, **alerts** (still audible when the
window is unfocused unless turned off), **ambience**, **interface**.

**Audience principle (S8, Tom 2026-10-04):** a cue is heard by the players
involved, not by the whole map. The one exception: the Hegemon hears every
missile launch in the galaxy. A detonation is heard by all.

## 3. Changes since the fork

The fork's first commit is 2026-09-19.

| Date       | Change                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | OpenFront's `proprietary/` overlay became `branding/`. The three audio paths that pointed at their closed files (menu theme, gameplay music, lobby start alert) got silent placeholder files so the code kept working.                                                            |
| 2026-10-04 | Tom recorded **`launch`** (troops leaving the Dark Star or a stargate), **`landing`** (those troops coming down) and **`missile`** (a warhead leaving a stargate). Wired under the audience principle. The inherited atom/hydrogen/MIRV launch cues stopped playing (files kept). |
| 2026-10-12 | **The fleet cue:** Tom's `invasion.mp3` replaces the inherited boat horn (`transport-ship.mp3`, kept on disk, no longer referenced) behind the unchanged `transport-ship` key: your Fleet setting out, heard by you.                                                              |
| 2026-10-12 | **The soundtrack:** Tom's five AI-generated tracks replace the two silent music placeholders. One continuous cycle through menu, lobby and game with a four-second crossfade between tracks (`Soundtrack.ts`, replacing `MenuMusic.ts` and the gameplay loop).                    |

## 4. The ledger

### 4.1 Music (ours, 2026-10-12)

Played in this order, wrapping round, for the whole session.

| #   | Track                 | File                        | Length |
| --- | --------------------- | --------------------------- | ------ |
| 1   | The Hegemon           | `the-hegemon.mp3`           | 2:38   |
| 2   | Dark Expanse          | `dark-expanse.mp3`          | 3:02   |
| 3   | Whispers of Rebellion | `whispers-of-rebellion.mp3` | 2:42   |
| 4   | Throne of Stars       | `throne-of-stars.mp3`       | 2:10   |
| 5   | The Fall              | `the-fall.mp3`              | 1:48   |

### 4.2 Cues that play

Origin: **OF** = inherited from OpenFront (CC BY-SA), **ours** = made for this
game. Player-facing unit names are used; the code keeps the old ones.

| Cue                   | File                      | When                                                                                      | Who hears it                                             | Channel   | Origin |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------- | ------ |
| `spawn`               | `spawn.mp3`               | You place or re-place your spawn                                                          | You                                                      | effects   | OF     |
| `game-start`          | `game-start.mp3`          | The spawn phase ends                                                                      | Everyone                                                 | effects   | OF     |
| `launch`              | `launch.mp3`              | Troops leave the Dark Star or a stargate (the opening flight, a strike, a gate shot)      | The launcher and the owner of the aimed tile             | effects   | ours   |
| `landing`             | `landing.mp3`             | Those troops come down (once per tick at most)                                            | The launcher and the owner of the land they land on      | effects   | ours   |
| `missile`             | `missile.mp3`             | A warhead leaves a stargate                                                               | The launcher, the target's owner, and always the Hegemon | effects   | ours   |
| `atom-hit`            | `atom-hit.mp3`            | A Nuclear Warhead detonates; each MIRV warhead (rate-limited)                             | Everyone                                                 | effects   | OF     |
| `hydrogen-hit`        | `hydrogen-hit.mp3`        | An Antimatter Warhead detonates                                                           | Everyone                                                 | effects   | OF     |
| `nuke-warning`        | `nuke-warning.mp3`        | A warhead is inbound on your land (rate-limited)                                          | The target                                               | alerts    | OF     |
| `conquered`           | `conquered.mp3`           | You eliminate a human player                                                              | You                                                      | effects   | OF     |
| `ka-ching`            | `ka-ching.mp3`            | You eliminate a Baron or a Lord                                                           | You                                                      | effects   | OF     |
| `build-city`          | `build-city.mp3`          | Your City is built                                                                        | You                                                      | effects   | OF     |
| `build-port`          | `build-port.mp3`          | Your Spaceport is built                                                                   | You                                                      | effects   | OF     |
| `build-factory`       | `build-factory.mp3`       | Your Factory is built                                                                     | You                                                      | effects   | OF     |
| `build-defense-post`  | `build-defense-post.mp3`  | Your Defense Post or Shield Array is built                                                | You                                                      | effects   | OF     |
| `silo-built`          | `silo-built.mp3`          | Your Stargate (or Missile Silo, which is disabled under a Dark Star) is built             | You                                                      | effects   | OF     |
| `build-warship`       | `build-warship.mp3`       | Your Destroyer is launched                                                                | You                                                      | effects   | OF     |
| `transport-ship`      | `invasion.mp3`            | Your Fleet sets out (Tom's cue since 2026-10-12; the inherited boat horn is kept on disk) | You                                                      | effects   | ours   |
| `build-train-station` | `build-train-station.mp3` | A structure of yours gains a freighter station (once per tick at most)                    | You                                                      | effects   | OF     |
| `alliance-suggested`  | `alliance-suggested.mp3`  | Someone proposes an alliance to you                                                       | You                                                      | alerts    | OF     |
| `alliance-accepted`   | `alliance-accepted.mp3`   | Your proposal is accepted                                                                 | You                                                      | alerts    | OF     |
| `alliance-declined`   | `alliance-declined.mp3`   | Your proposal is declined                                                                 | You                                                      | alerts    | OF     |
| `alliance-broken`     | `alliance-broken.mp3`     | An alliance of yours is broken                                                            | You                                                      | alerts    | OF     |
| `message`             | `alliance-suggested.mp3`  | A chat message addressed to you (same morse cue as the proposal, by the designer's note)  | You                                                      | alerts    | OF     |
| `victory`             | `victory.mp3`             | The win screen, won                                                                       | You                                                      | effects   | OF     |
| `defeat`              | `defeat.mp3`              | The win screen, lost                                                                      | You                                                      | effects   | OF     |
| `click`               | `click.mp3`               | A radial-menu pick                                                                        | You                                                      | interface | OF     |
| `slider`              | `slider.mp3`              | A settings slider tick                                                                    | You                                                      | interface | OF     |
| `sam-built`           | `sam-built.mp3`           | A SAM Launcher is built — **never heard**: the unit is disabled under a Dark Star         | —                                                        | effects   | OF     |

### 4.3 Ambience (OF)

Loops that fade in when the view is zoomed well in on one of your structures
and fade out as the player pulls back; the zoom envelope sits 20 dB under the
cues.

| Track          | File               | Structure                                                          |
| -------------- | ------------------ | ------------------------------------------------------------------ |
| `city`         | `city.mp3`         | City                                                               |
| `factory`      | `factory.mp3`      | Factory                                                            |
| `missile-silo` | `missile-silo.mp3` | Missile Silo — never heard, the unit is disabled under a Dark Star |
| `sam-silo`     | `sam-silo.mp3`     | SAM Launcher — never heard, same reason                            |

### 4.4 Files that do not play

Registered in `Sounds.ts` but no longer emitted anywhere:

- `atom-launch.mp3`, `hydrogen-launch.mp3`, `mirv-launch.mp3` — retired
  2026-10-04 in favour of `missile`.
- `click-1.mp3`, `click-2.mp3`, `click-3.mp3` — inherited variants nothing calls.

On disk and not registered at all (the "four orphans"):

- `warship-lost.mp3`, `warship-shot.mp3`, `sam-hit.mp3`, `sam-shoot.mp3`.

Silent placeholder:

- `game-start-alert.mp3` — the bell `JoinLobbyModal` rings when a game you are
  waiting for starts. Plays, but there is nothing in the file.

None of these is a licensing problem (all CC BY-SA or ours). They are clutter,
to be wired or deleted whenever convenient; the SAM and silo entries can go
with them since those units never appear.

## 5. Still to do

- **Tom's additional sounds.** He has more in mind and will share them one at
  a time; each is wired on arrival (§6) and recorded in §3 and §4. No
  definitive list yet.
- **The lobby bell** (`game-start-alert`): a real file for the silent one.
- **Candidates nobody has decided on** (from the roadmap's P4, kept here as
  ideas only): strike inbound, punitive levy, the last stand, the Hegemon
  overthrown, timer victory. Strike landed and gate fired are covered by
  `landing`, `launch` and `missile`.
- **Verify in a real round** that every cue in §4.2 is actually heard (S8:
  silence in play is a bug to diagnose, not a missing asset).
- **Tidy §4.4** when wanted.

## 6. Adding or replacing a sound

1. Tom describes the moment it marks and **who should hear it** (the audience
   principle), and supplies the file (MP3; his own recording or generation,
   or a CC0 / CC BY source with the credit line).
2. The file goes under `resources/sounds/effects/` (or `ambience/`, or
   `music/`), named for the cue.
3. `Sounds.ts`: a `SoundEffect` name, its URL and its channel (the type makes
   a missing channel a compile error).
4. The rule: a case in `SoundEffectController` (or the relevant HUD layer)
   that emits it to the right audience, with a test beside the existing ones
   in `tests/client/controllers/`.
5. `CREDITS.md` if the source needs a credit; this document's §3 and §4
   either way.

## 7. Changelog

- **2026-10-12** — Document created: the ledger of every sound, the changes
  since the fork, and the finding that nothing inherited needs removing. The
  roadmap's P4 now points here.

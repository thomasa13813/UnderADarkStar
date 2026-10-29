---
title: Thrones and lobbies
description: Public lobbies in Under a Dark Star are thrones - rooms that run rounds back to back, where the winner keeps the seat. Rooms, reigns, the leaderboard and private lobbies.
section: The throne
order: 3
related: the-round, hegemon
---

## Thrones

Public lobbies are **thrones**: named rooms that run rounds back to back. A room is Free for all
or Teams for life.

- The home page shows the room starting soonest in each mode.
- The lobby browser lists every throne under **Free for all** or **Teams**, with
  **Watch** to spectate a running round.

## After a round

The winner has {{window}} seconds to pick the next map (on a team throne, how the teams split too)
and to **keep the throne or step down**. With no answer, the next map is random and the seat opens:
the AI holds it, and anyone in the lobby may claim it.

## The seat

- An open seat is first come, first served: claim it in the lobby, or give it up before the start.
- On a team throne the teams are balanced at the start, on numbers alone: you cannot choose your
  team, and clans and friends are not grouped. The winner chooses between 2 and 7 teams.
- If nobody holds it, the AI Hegemon plays.
- A round needs two humans to start, the Hegemon included.

## Rooms

There is one room for each mode, and more open when they fill: once every room of a mode holds
three quarters of its {{roomCap}} players, another opens, and it closes again after a minute with
nobody in it. Each room counts down on its own: {{roomCountdown}} seconds once two humans are in,
at once when it is full. The next round's lobby opens the moment a round ends, and its countdown
runs while the winner chooses, but never ends before the winner has had their {{window}} seconds.

## Joining a round in progress

You can join a room whose round is already running, up to its {{roomCap}} players:

- **During the spawn phase** you pick a starting location like everyone else and play as a
  challenger.
- **After it** you come in as a [[piracy|pirate]]: your first corsair can sail
  {{dropInWait}} seconds into play. The same goes for anyone who was in the round but never picked
  a spawn.
- **In the last {{dropInCutoff}} minutes** nobody joins: you watch the end, and you are placed in
  the room's next lobby.
- On a team throne you join the team with the fewest players.
- Leave and come back to the same round and you get your own player back.
- A player who joined after the start may still land the killing blow, but **the round is then
  void**: nobody is credited, and the seat opens for the next round.

## Reigns and the leaderboard

- The throne card counts a **reign** in consecutive rounds held on the same throne: a slayer
  starts at 1, and each timer win adds one.
- On a team throne the seat goes to the player who landed the killing blow, not to the team.
- The leaderboard records **victories** (rounds won, whether or not the winner takes the throne),
  **reigns** (rounds played as Hegemon) and the **longest reign** (the most consecutive rounds as
  Hegemon on one throne).

## Private lobbies

In a private lobby the creator seats the Hegemon by clicking a player's crown. **New Lobby** from
the win screen carries the settings over and seats the winner as they arrive.

In a private team lobby, click a team's card to join that team. In Duos, Trios and Quads a full
team takes no more players. Anyone who doesn't pick is placed at the start, with clanmates kept
together and friends grouped where possible. Lords fill the places left over.

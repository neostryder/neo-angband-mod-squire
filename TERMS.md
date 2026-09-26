# Terms of Use for the Neo Angband Squire Mod

Effective date: 2026-09-06.

Squire is an optional mod folder that runs inside Neo Angband, with no separate hosted service. It provides an autoplayer that runs one bounded errand and then stops issuing commands. Its current errands are engaging a single creature, walking out the unexplored part of a floor, and a longer errand that carries the character until there is nothing left to do on the floor. The mod is disabled until enabled, its individual errands and stop conditions can be changed in the mod controls, and it takes the keyboard only when the player asks it to with the game's own Ctrl-Z activation.

Its shipped manifest declares four capabilities: `command:add`, `state:player.read`, `state:monsters.read` and `state:map.read`. These let the mod issue commands the game already accepts and read the character, the visible creatures, and the player's own map knowledge. It does not declare access to, or read, the message stream, the pack, the stores, or the spellbooks. It declares no network access, and its shipped plugin code makes no network requests.

The mod stores no data of its own: no preference file, no save bag, and nothing held across a session. Its settings are the manifest rules the host resolves and passes to it, and it reads what it knows about the world fresh from the game for each decision. It draws no random numbers, so the game's own random number generator is unaffected.

Handing a character to any autoplayer, including Squire, permanently marks that save as having used one, and the character can no longer earn a high score. The game sets that mark, not the mod; it applies from the moment the keyboard is handed over and cannot be cleared. The player is responsible for deciding whether to hand over a character and for keeping an export or backup of local game data.

Installing or updating the mod from the in-game mod manager can fetch its public files from GitHub; those requests come from the Neo Angband host's mod manager. The core Neo Angband Terms and Privacy Policy cover that shared host behavior, including local storage, update checks, and the risks of optional third-party mods.

The GPL v2 or Angband licence in `LICENSE.md` governs copying, modification, and distribution of covered material. This document does not add a condition to those rights. The mod is provided as available and without a promise of compatibility, availability, security, accuracy, or fitness for a particular purpose, to the extent permitted by applicable law.

Use must comply with applicable law, the applicable licences, and the Neo Angband Terms. Project participation is subject to the shared Code of Conduct.

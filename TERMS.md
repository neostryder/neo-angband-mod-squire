# Terms of Use for the Neo Angband Squire Mod

Effective date: 2026-09-06.

Squire is an optional Neo Angband mod folder, not a separate hosted service. It provides an autoplayer that runs one bounded errand and then stops issuing commands. Its current errands are engaging a single creature, walking out the unexplored part of a floor, and a longer errand that carries the character until there is nothing left to do on the floor. The mod is disabled until enabled, its individual errands and stop conditions can be changed in the mod controls, and it never takes the keyboard until the player asks it to with the game's own Ctrl-Z activation.

The examined shipped manifest declares four capabilities: `command:add`, `state:player.read`, `state:monsters.read` and `state:map.read`. Those let the mod issue commands the game already accepts and read the character, the visible creatures and the player's own map knowledge. It does not declare access to the message stream, the pack, the stores or the spellbooks, and it does not read them. It declares no network access, and the examined shipped plugin code makes no network requests.

The mod stores no data of its own. It writes no preference file, keeps no save bag, and holds nothing across a session: its settings are the manifest rules the host resolves and hands to it, and everything it knows about the world is read fresh from the game on each decision. It draws no random numbers, so it does not perturb the game's own generator.

Handing a character to any autoplayer, including this one, permanently marks that save as having used one, and the game then refuses that character a high score. That mark is set by the game rather than by this mod, it cannot be cleared, and it applies from the moment the keyboard is handed over. A player remains responsible for deciding whether to hand over a character and for keeping a desired export or backup of local game data.

In-game installation or update can retrieve public files through the Neo Angband host mod manager. The core Neo Angband Terms and Privacy Policy describe those shared host behaviors, including local storage, update checks, and optional third-party mod risks.

The GPL v2 or Angband licence in `LICENSE.md` governs copying, modification, and distribution of covered material. This document does not add a condition to those rights. The mod is provided as available and without a promise of compatibility, availability, security, accuracy, or fitness for a particular purpose, to the extent permitted by applicable law.

Use must comply with applicable law, the applicable licences, and the Neo Angband Terms. Project participation is subject to the shared Code of Conduct.

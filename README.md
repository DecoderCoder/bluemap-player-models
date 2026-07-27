# BlueMap Player Models

A server-side Forge 1.20.1 add-on for BlueMap 5.12 that replaces the map's
floating player heads with animated 3D player models.

## Features

- Skin-textured 3D player models at live map positions
- Walking limb animation and smooth movement
- Visible armor, main-hand, and off-hand equipment
- Click a model to open its selected-player card and inventory
- Gray offline models at saved logout positions
- Logout snapshots persisted in the world's `data` folder
- Responsive, keyboard-friendly inventory dialog

Armor uses colored 3D shells and held items use colored silhouettes. This keeps
the add-on server-only and avoids bundling Minecraft's client item-model and
resource-pack pipeline. Item names, counts, durability, and exact registry IDs
remain available in the inventory tooltip.

## Requirements

- Minecraft 1.20.1
- Forge 47.x
- [BlueMap 5.12 Forge 1.20–1.20.4](https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.12)
- Java 21 or newer on the server

Use `bluemap-5.12-mc1.20-6-forge.jar`; the unqualified
`bluemap-5.12-forge.jar` targets newer Minecraft versions.

## Install

1. Build with `gradlew.bat build` on Windows or `./gradlew build` elsewhere.
2. Copy `build/libs/bluemap_player_models-1.0.1.jar` into the server's `mods`
   folder beside `bluemap-5.12-mc1.20-6-forge.jar`.
3. Start the server. No client installation or manual webapp edit is needed.

The jar is safe if a modpack synchronizer also copies it to clients: its
BlueMap integration is initialized only on a dedicated server.

The add-on copies and registers its JavaScript/CSS through BlueMapAPI. Players
appear after BlueMap has loaded a map and the player has joined once. Skin files
are fetched from Mojang's texture server and cached in BlueMap's webroot.

## Privacy

The inventory dialog is visible to anyone who can access the BlueMap webapp.
Do not deploy it on a public map unless publishing player inventories is
intentional.

## Checks

```text
gradlew.bat build
node src/test/js/player-models.test.cjs
```

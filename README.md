# BlueMap Player Models

A server-side Forge 1.20.1 add-on for BlueMap 5.12 that adds animated player
models and loaded entities to the map.

## Features

- Skin-textured 3D player models attached to BlueMap's live player markers
- Walking animation, head pitch, and BlueMap's smooth position updates
- Armor textures plus main-hand and off-hand item sprites
- Click a player for Inventory, Center, and Follow actions
- Gray offline players at their saved logout positions
- Logout snapshots persisted in the world's `data` folder
- Up to 128 loaded non-player entities per mapped world, with vanilla textures
  and simple 3D model families
- BlueMap-styled, responsive settings and inventory side panels

The add-on reuses BlueMap's texture gallery when possible and exposes vanilla
entity, armor, item, and block textures from the Minecraft client jar already
downloaded by BlueMap. Missing or modded models use a simple fallback; arbitrary
client-only entity renderers and item models are not available on a dedicated
server.

## Requirements

- Minecraft 1.20.1
- Forge 47.x
- [BlueMap 5.12 Forge 1.20–1.20.4](https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.12)
- Java 21 or newer on the server

Use `bluemap-5.12-mc1.20-6-forge.jar`; the unqualified
`bluemap-5.12-forge.jar` targets newer Minecraft versions.

## Install

1. Build with `gradlew.bat build` on Windows or `./gradlew build` elsewhere.
2. Copy `build/libs/bluemap_player_models-1.1.0.jar` into the server's `mods`
   folder beside `bluemap-5.12-mc1.20-6-forge.jar`.
3. Start the server. No client installation or manual webapp edit is needed.

The jar is safe if a modpack synchronizer also copies it to clients: its
BlueMap integration is initialized only on a dedicated server.

The add-on copies and registers versioned JavaScript/CSS through BlueMapAPI.
Players appear after BlueMap has loaded a map and the player has joined once.
Skins are obtained through BlueMap's configured skin provider and cached in its
webroot.

## Privacy

Complete inventories are included in the map's JSON asset so the browser can
render them; they are not access-controlled separately from BlueMap. Do not
deploy this add-on on a public map unless publishing player inventories is
intentional.

## Checks

```text
gradlew.bat build
node src/test/js/player-models.test.cjs
```

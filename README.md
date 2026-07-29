# BlueMap Player Models

A server-side Forge 1.20.1 add-on for BlueMap 5.12 that adds animated player
models and loaded entities to the map.

## Features

- Skin-textured 3D player models on interval-synchronized position anchors
- Walking animation, head pitch, smooth follow, and a followed player's look ray
- Extracted vanilla, mod, and configured resource-pack textures and model JSON
- JSON item models for inventory and label icons, including layers, block elements,
  parent inheritance, damage/custom-model-data overrides, and common item tints
- Exact default armor-material textures, overlays, and trims
- Player labels with the skin head on the left and held-item icon on the right
- Click a player for Inventory, Center, and Follow actions
- Gray offline players at their saved logout positions
- Logout snapshots persisted in the world's `data` folder
- Historical offline players imported from Minecraft's existing `playerdata`
- Up to 128 loaded non-player entities per mapped world, with extracted vanilla
  textures and exact baked 1.20.1 model-layer geometry
- BlueMap-styled, responsive settings and inventory side panels
- Stable inventory slots that do not blink when live data refreshes
- Independent 1-30 second player and entity display-update intervals
- Opt-in BETA real-time online-player movement with polling fallback

The add-on reads a deterministic server-visible client-resource stack:
BlueMap's downloaded vanilla client jar, loaded mod resources, then entries in
`config/bluemap/packs` in filename order. The last pack wins. Models, textures,
animation metadata, and atlas definitions are published as SHA-256
content-addressed objects under BlueMap's web root. Atlas aliases and palette
permutations (including armor trims) are resolved during extraction. The
browser caches parsed models, textures, and rendered icons, and selects one
deterministic frame from animated item textures.

Minecraft entity geometry is Java code rather than resource-pack model JSON. The
build therefore bakes Forge's mapped Minecraft 1.20.1 model layers into a compact
browser asset. Vanilla entities with a matching layer use its exact cuboids,
rotations, inflation, omitted faces, and UV layout; unsupported and modded
entities retain the deterministic family fallback. State-only renderer layers,
`builtin/entity`, Forge custom model loaders, live compass/clock properties, and
other client-only renderers use deterministic fallbacks because a dedicated
server cannot run Minecraft's client renderer. Mod armor using the normal
`ArmorMaterial` texture convention is resolved exactly; armor supplied only
through a client-side custom renderer cannot be.

## Requirements

- Minecraft 1.20.1
- Forge 47.x
- [BlueMap 5.12 Forge 1.20-1.20.4](https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.12)
- Java 21 or newer on the server

Use `bluemap-5.12-mc1.20-6-forge.jar`; the unqualified
`bluemap-5.12-forge.jar` targets newer Minecraft versions.

## Install

1. Build with `gradlew.bat build` on Windows or `./gradlew build` elsewhere.
2. Copy `build/libs/bluemap_player_models-1.3.3.jar` into the server's `mods`
   folder beside `bluemap-5.12-mc1.20-6-forge.jar`.
3. Start the server. No client installation or manual webapp edit is needed.

The jar is safe if a modpack synchronizer also copies it to clients: its
BlueMap integration is initialized only on a dedicated server.

The add-on copies and registers versioned JavaScript/CSS through BlueMapAPI.
Players appear after BlueMap has loaded a map. Existing logout positions are
imported from Minecraft's player data when their dimension has a BlueMap map.
Full skins use the signed texture URL already present in each online player's
profile, with BlueMap's configured skin provider as a fallback. Fingerprinted
PNGs are cached through every map's BlueMap asset storage. Skin heads are cut
from the same full skin in the browser, so the label and 3D model stay in sync.

## BETA same-port live updates

Real-time movement is disabled by default. Turn on the `BETA` switch in the
Player Models settings to use it; normal JSON polling remains active for
metadata and automatic fallback.

The add-on registers `/bluemap-player-models/live` directly on BlueMap 5.12's
built-in webserver. It automatically uses the same origin and port as the map,
including `http://direct.decodercoder.com:8100/`. No second public port or
reverse proxy is needed.

BlueMap 5.12 does not expose raw connections for a WebSocket upgrade, so this
mode uses one long-lived HTTP request that completes on the next movement
snapshot and is immediately renewed. Movement still arrives in real time
without interval polling. The route uses BlueMap 5.12's implementation API,
which is why the required BlueMap version is pinned above.

The live route exposes the same visible player coordinates as the map. If HTTP
access control is added later, it must cover `/bluemap-player-models/live` too.
Live traffic is excluded from BlueMap's activity log to avoid high-volume access
logs; ordinary BlueMap requests are unchanged.

## Privacy

Complete inventories are included in the map's JSON asset so the browser can
render them; they are not access-controlled separately from BlueMap. Do not
deploy this add-on on a public map unless publishing player inventories is
intentional.

The extracted vanilla, mod, and configured-pack client assets are also
published beneath the public BlueMap web root. Do not put private material in a
server resource pack used by this add-on.

## Checks

```text
gradlew.bat build
node src/test/js/player-models.test.cjs
```

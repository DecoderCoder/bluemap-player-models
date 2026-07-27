const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

global.__BPM_TEST__ = true;
vm.runInThisContext(fs.readFileSync("src/main/resources/web/player-models.js", "utf8"));

const {
    armorTextureKey,
    boxRegions,
    entityFamily,
    entityTextureKeys,
    inventoryOrder,
    mapAssetUrl,
    normalizeInterval,
    playerDataUrl,
    splitId
} = global.__BPM_TEST_API__;
assert.deepEqual(boxRegions(16, 16, 8, 12, 4), [
    [28, 20, 4, 12],
    [16, 20, 4, 12],
    [20, 16, 8, 4],
    [28, 16, 8, 4],
    [20, 20, 8, 12],
    [32, 20, 8, 12]
]);
assert.deepEqual(inventoryOrder(Array.from({length: 36}, (_, index) => index)).map(slot => slot.index), [
    9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 1, 2, 3, 4, 5, 6, 7, 8
]);
assert.equal(
    playerDataUrl({mapDataRoot: "maps/world", dataUrl: "old/"}),
    "maps/world/assets/bluemap-player-models/players.json"
);
assert.equal(
    playerDataUrl({dataUrl: "maps/world/"}),
    "maps/world/assets/bluemap-player-models/players.json"
);
assert.equal(
    mapAssetUrl(
        {mapDataRoot: "custom/maps/world/"},
        "bluemap-player-models/skins/player skin.png"
    ),
    "custom/maps/world/assets/bluemap-player-models/skins/player%20skin.png"
);
assert.equal(mapAssetUrl({mapDataRoot: "maps/world"}, "../bad.png"), null);
assert.equal(normalizeInterval(5000), 5000);
assert.equal(normalizeInterval(0), 1000);
assert.deepEqual(splitId("minecraft:diamond_sword"), {
    namespace: "minecraft",
    path: "diamond_sword"
});
assert.equal(splitId("../bad"), null);
assert.equal(
    armorTextureKey("minecraft:golden_chestplate", 1),
    "minecraft:models/armor/gold_layer_1"
);
assert.equal(
    armorTextureKey("minecraft:diamond_leggings", 2),
    "minecraft:models/armor/diamond_layer_2"
);
assert.equal(entityFamily("minecraft:creeper"), "creeper");
assert.equal(entityFamily("minecraft:cow"), "quadruped");
assert.equal(entityFamily("minecraft:zombie"), "humanoid");
assert.equal(entityFamily("example:unknown_beast"), "generic");
assert.deepEqual(
    entityTextureKeys("minecraft:creeper"),
    ["minecraft:entity/creeper/creeper"]
);
assert.deepEqual(
    entityTextureKeys("example:unknown_beast"),
    ["example:entity/unknown_beast/unknown_beast"]
);

console.log("player-models self-check passed");

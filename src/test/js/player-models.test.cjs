const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

global.__BPM_TEST__ = true;
const source = fs.readFileSync("src/main/resources/web/player-models.js", "utf8");
vm.runInThisContext(source);
assert.doesNotMatch(source, /playerheads\/|minecraft\/assets\/|pending/);
assert.match(source, /realtimeRetryMs = Math\.min\(realtimeRetryMs \* 2, 60000\)/);
assert.doesNotMatch(source, /if \(wasConnected\) retryRealtime\(token\);/);
assert.doesNotMatch(source, /new window\.WebSocket/);

const {
    armorTextureKey,
    boxRegions,
    defaultFaceUv,
    entityFamily,
    entityModelKeys,
    entityTextureKeys,
    firstAnimationFrame,
    grayscaleRgba,
    inventoryOrder,
    interpolationSpeed,
    itemVisualKey,
    mapAssetUrl,
    mergePlayerMotion,
    minecraftSkinUrl,
    modelOverrideMatches,
    normalizeResourceId,
    normalizeInterval,
    playerDataUrl,
    playerLiveUrl,
    resolveTextureReference,
    syncSlotNodes,
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
    playerLiveUrl("http://example.test/maps/world", "world", 7),
    "http://example.test/bluemap-player-models/live?mapId=world&after=7"
);
assert.equal(
    playerLiveUrl("https://example.test:8443/maps/world", "world 2", 9),
    "https://example.test:8443/bluemap-player-models/live?mapId=world+2&after=9"
);
const currentMotion = {
    x: 9,
    y: 8,
    z: 7,
    yaw: 6,
    pitch: 5,
    moving: true,
    crouching: true,
    lastSeen: 200
};
assert.deepEqual(
    mergePlayerMotion(currentMotion, {
        x: 1,
        y: 2,
        z: 3,
        yaw: 4,
        pitch: 5,
        moving: false,
        crouching: false,
        lastSeen: 100,
        inventory: ["new"]
    }, 200),
    {...currentMotion, inventory: ["new"]}
);
assert.deepEqual(
    mergePlayerMotion(currentMotion, {...currentMotion, x: 10, lastSeen: 300}, 200),
    {...currentMotion, x: 10, lastSeen: 300}
);
assert.equal(
    mapAssetUrl(
        {mapDataRoot: "custom/maps/world/"},
        "bluemap-player-models/skins/player skin.png"
    ),
    "custom/maps/world/assets/bluemap-player-models/skins/player%20skin.png"
);
assert.equal(mapAssetUrl({mapDataRoot: "maps/world"}, "../bad.png"), null);
assert.equal(
    minecraftSkinUrl("http://textures.minecraft.net/texture/abcdef"),
    null
);
assert.equal(
    minecraftSkinUrl("https://textures.minecraft.net/texture/31f477eb1a7beee6"),
    "https://textures.minecraft.net/texture/31f477eb1a7beee6"
);
assert.equal(minecraftSkinUrl("https://example.com/texture/abcdef"), null);
assert.equal(normalizeInterval(5000), 5000);
assert.equal(normalizeInterval(0), 1000);
assert.equal(interpolationSpeed(10, 1000), 0.01);
assert.equal(interpolationSpeed(2, 1000), 0.002);
assert.equal(interpolationSpeed(-1, 1000), 0);
assert.equal(interpolationSpeed(10, 0), 10);
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
assert.deepEqual(entityModelKeys("minecraft:pig"), ["minecraft:pig"]);
assert.deepEqual(entityModelKeys("minecraft:pufferfish"), [
    "minecraft:pufferfish_big"
]);
assert.deepEqual(entityModelKeys("minecraft:boat"), ["minecraft:boat"]);
assert.deepEqual(entityModelKeys("example:unknown_beast"), ["example:unknown_beast"]);
assert.deepEqual(
    entityTextureKeys("minecraft:creeper"),
    ["minecraft:entity/creeper/creeper"]
);
assert.deepEqual(
    entityTextureKeys("minecraft:mooshroom"),
    ["minecraft:entity/cow/red_mooshroom"]
);
assert.deepEqual(
    entityTextureKeys("example:unknown_beast"),
    ["example:entity/unknown_beast/unknown_beast"]
);
assert.equal(normalizeResourceId("item/diamond_sword"), "minecraft:item/diamond_sword");
assert.equal(normalizeResourceId("example:item/hammer"), "example:item/hammer");
assert.equal(normalizeResourceId("../secret"), null);
assert.equal(
    resolveTextureReference({layer0: "#base", base: "item/apple"}, "#layer0"),
    "minecraft:item/apple"
);
assert.equal(resolveTextureReference({a: "#b", b: "#a"}, "#a"), null);
const from = [1, 2, 3];
const to = [11, 13, 15];
assert.deepEqual(defaultFaceUv(from, to, "down"), [1, 1, 11, 13]);
assert.deepEqual(defaultFaceUv(from, to, "up"), [1, 3, 11, 15]);
assert.deepEqual(defaultFaceUv(from, to, "north"), [5, 3, 15, 14]);
assert.deepEqual(defaultFaceUv(from, to, "south"), [1, 3, 11, 14]);
assert.deepEqual(defaultFaceUv(from, to, "west"), [3, 3, 15, 14]);
assert.deepEqual(defaultFaceUv(from, to, "east"), [1, 3, 13, 14]);
assert.deepEqual(firstAnimationFrame({animation: {frames: [2]}}, 16, 64), {
    repeatX: 1,
    repeatY: 0.25,
    offsetX: 0,
    offsetY: 0.25
});
assert.deepEqual(firstAnimationFrame({animation: {frames: [{index: 3}]}}, 64, 16), {
    repeatX: 0.25,
    repeatY: 1,
    offsetX: 0.75,
    offsetY: 0
});
assert.equal(firstAnimationFrame({}, 16, 64), null);
assert.deepEqual(
    [...grayscaleRgba(new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 128,
        0, 0, 255, 0
    ]))],
    [
        54, 54, 54, 255,
        182, 182, 182, 128,
        18, 18, 18, 0
    ]
);

const sword = {
    id: "minecraft:diamond_sword",
    name: "Diamond Sword",
    count: 1,
    damage: 3,
    maxDamage: 1561,
    glint: false,
    customModelData: 0
};
assert.equal(itemVisualKey(sword), itemVisualKey({...sword, count: 2}));
assert.notEqual(itemVisualKey(sword), itemVisualKey({...sword, damage: 4}));
assert.notEqual(itemVisualKey(sword), itemVisualKey({...sword, customModelData: 7}));
assert.equal(modelOverrideMatches({damage: 0.5}, {...sword, damage: 800}), true);
assert.equal(modelOverrideMatches({broken: 1}, {...sword, damage: 1560}), true);
assert.equal(modelOverrideMatches({lefthanded: 1}, {...sword, leftHanded: true}), true);
assert.equal(modelOverrideMatches({firework: 1}, {...sword, firework: true}), true);
assert.equal(modelOverrideMatches({brushing: 1}, {...sword, active: true}), true);
assert.equal(modelOverrideMatches({filled: 1}, {...sword, filled: true}), true);
assert.equal(modelOverrideMatches({level: 0.5}, {...sword, level: 8 / 15}), true);
assert.equal(modelOverrideMatches({angle: 0, time: 0}, sword), true);
assert.equal(modelOverrideMatches({trim_type: 0.8}, {...sword, trimType: 0.9}), true);
assert.equal(modelOverrideMatches({unknown: 1}, sword), false);

const fakeContainer = {
    children: [],
    append(node) {
        return this.insertBefore(node, null);
    },
    insertBefore(node, reference) {
        if (node.parent === this) {
            this.children.splice(this.children.indexOf(node), 1);
        }
        const index = reference ? this.children.indexOf(reference) : this.children.length;
        this.children.splice(index, 0, node);
        node.parent = this;
        return node;
    }
};
const fakeNode = () => ({
    dataset: {},
    parent: null,
    replaceWith(replacement) {
        const index = this.parent.children.indexOf(this);
        this.parent.children[index] = replacement;
        replacement.parent = this.parent;
        this.parent = null;
    },
    remove() {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
});
let createdSlots = 0;
const createSlot = () => {
    createdSlots++;
    return fakeNode();
};
const slots = [
    {slot: "inventory:0", item: sword},
    {slot: "inventory:1", item: {...sword, id: "minecraft:apple", name: "Apple"}}
];
syncSlotNodes(fakeContainer, slots, createSlot);
const originalSlots = [...fakeContainer.children];
syncSlotNodes(fakeContainer, slots.map(slot => ({...slot, update: node => node.stable = true})), createSlot);
assert.equal(createdSlots, 2);
assert.equal(fakeContainer.children[0], originalSlots[0]);
assert.equal(fakeContainer.children[1], originalSlots[1]);
assert.equal(fakeContainer.children[0].stable, true);
syncSlotNodes(fakeContainer, [
    slots[0],
    {...slots[1], item: {...slots[1].item, count: 2}}
], createSlot);
assert.equal(createdSlots, 2);
assert.equal(fakeContainer.children[0], originalSlots[0]);
assert.equal(fakeContainer.children[1], originalSlots[1]);

const entityModels = JSON.parse(fs.readFileSync(
    "build/generated/entity-models/web/entity-models.json",
    "utf8"
));
assert.equal(entityModels.format, 1);
assert.equal(entityModels.minecraft, "1.20.1");
for (const id of [
    "minecraft:bee",
    "minecraft:chicken",
    "minecraft:cow",
    "minecraft:pig"
]) {
    const model = entityModels.models[id];
    assert.ok(model, `Missing generated ${id} model`);
    assert.ok(model.positions.length > 0, `Empty generated ${id} model`);
    assert.equal(model.positions.length % 9, 0);
    assert.equal(model.uvs.length, model.positions.length / 3 * 2);
    assert.ok(model.positions.every(Number.isFinite));
    assert.ok(model.uvs.every(Number.isFinite));
}
assert.notDeepEqual(
    entityModels.models["minecraft:pig"].positions,
    entityModels.models["minecraft:cow"].positions
);
assert.equal(entityModels.models["minecraft:boat/oak"], undefined);
assert.equal(entityModels.models["minecraft:ender_dragon"], undefined);
assert.equal(entityModels.models["minecraft:minecart"], undefined);
assert.equal(entityModels.models["minecraft:slime"], undefined);
const ghastPositions = entityModels.models["minecraft:ghast"].positions;
assert.ok(Math.max(...ghastPositions) - Math.min(...ghastPositions) > 4);

console.log("player-models self-check passed");

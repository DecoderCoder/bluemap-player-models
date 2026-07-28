const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

global.__BPM_TEST__ = true;
vm.runInThisContext(fs.readFileSync("src/main/resources/web/player-models.js", "utf8"));

const {
    armorTextureKey,
    boxRegions,
    defaultFaceUv,
    entityFamily,
    entityTextureKeys,
    firstAnimationFrame,
    grayscaleRgba,
    inventoryOrder,
    itemVisualKey,
    mapAssetUrl,
    modelOverrideMatches,
    normalizeResourceId,
    normalizeInterval,
    playerDataUrl,
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

console.log("player-models self-check passed");

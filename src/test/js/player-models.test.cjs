const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

global.__BPM_TEST__ = true;
vm.runInThisContext(fs.readFileSync("src/main/resources/web/player-models.js", "utf8"));

const {boxRegions, inventoryOrder} = global.__BPM_TEST_API__;
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

console.log("player-models self-check passed");

(() => {
    "use strict";

    const VERSION = "1.2.5";
    const PIXEL = 0.05625;
    const DATA_ASSET = "assets/bluemap-player-models/players.json";
    const STORAGE_KEY = "bluemap-player-models-settings-v2";
    const REFRESH_INTERVALS = [1000, 2000, 5000, 10000, 30000];

    const boxRegions = (x, y, width, height, depth) => [
        [x + depth + width, y + depth, depth, height],
        [x, y + depth, depth, height],
        [x + depth, y, width, depth],
        [x + depth + width, y, width, depth],
        [x + depth, y + depth, width, height],
        [x + depth * 2 + width, y + depth, width, height]
    ];

    const inventoryOrder = inventory => [
        ...inventory.slice(9, 36).map((item, offset) => ({item, index: offset + 9})),
        ...inventory.slice(0, 9).map((item, index) => ({item, index}))
    ];

    const playerDataUrl = mapData => {
        const root = mapData?.mapDataRoot || mapData?.dataUrl;
        return root && `${root.replace(/\/$/, "")}/${DATA_ASSET}`;
    };

    const mapAssetUrl = (mapData, asset) => {
        const root = mapData?.mapDataRoot || mapData?.dataUrl;
        if (!root || !asset || asset.includes("..") || asset.startsWith("/")) return null;
        const path = asset.split("/").map(encodeURIComponent).join("/");
        return `${root.replace(/\/$/, "")}/assets/${path}`;
    };

    const minecraftSkinUrl = value => {
        try {
            const url = new URL(value);
            return url.protocol === "https:"
                && url.hostname === "textures.minecraft.net"
                && /^\/texture\/[a-f0-9]+$/i.test(url.pathname)
                ? url.href
                : null;
        } catch {
            return null;
        }
    };

    const normalizeInterval = value => {
        const interval = Number(value);
        return REFRESH_INTERVALS.includes(interval) ? interval : 1000;
    };

    const interpolationSpeed = (distance, interval) =>
        Math.max(0, distance) / Math.max(1, interval);

    const splitId = id => {
        const match = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(id || "");
        return match
            && !match[2].includes("..")
            && !match[2].startsWith("/")
            && !match[2].endsWith("/")
            && !match[2].includes("//")
            ? {namespace: match[1], path: match[2]}
            : null;
    };

    const normalizeResourceId = (value, namespace = "minecraft") => {
        if (typeof value !== "string" || value.startsWith("#")) return null;
        const id = value.includes(":") ? value : `${namespace}:${value}`;
        return splitId(id) ? id : null;
    };

    const itemVisualKey = item => item ? JSON.stringify([
        item.id,
        item.damage || 0,
        item.maxDamage || 0,
        item.color || null,
        item.customModelData || 0,
        item.tints || null,
        item.trimType || 0,
        item.armorTexture || null,
        item.armorOverlayTexture || null,
        item.trimTexture || null,
        !!item.active,
        item.useProgress || 0,
        !!item.charged,
        !!item.firework,
        !!item.filled,
        item.level || 0,
        !!item.cast,
        !!item.leftHanded
    ]) : "";

    const syncSlotNodes = (container, descriptors, create) => {
        const existing = new Map(
            Array.from(container.children, node => [node.dataset.slot, node])
        );
        descriptors.forEach((descriptor, index) => {
            const key = itemVisualKey(descriptor.item);
            let node = existing.get(descriptor.slot);
            if (!node || node.dataset.itemKey !== key) {
                const replacement = create(descriptor);
                replacement.dataset.slot = descriptor.slot;
                replacement.dataset.itemKey = key;
                if (node) node.replaceWith(replacement);
                else container.append(replacement);
                node = replacement;
            }
            descriptor.update?.(node);
            existing.delete(descriptor.slot);
            const current = container.children[index];
            if (current !== node) container.insertBefore(node, current || null);
        });
        existing.forEach(node => node.remove());
    };

    const modelPredicateValue = (name, item, context = {}) => {
        switch (name.replace(/^minecraft:/, "")) {
            case "custom_model_data": return Number(item?.customModelData || 0);
            case "damage": return item?.maxDamage > 0 ? item.damage / item.maxDamage : 0;
            case "damaged": return item?.damage > 0 ? 1 : 0;
            case "broken": return item?.maxDamage > 0
                && item.damage >= item.maxDamage - 1 ? 1 : 0;
            case "lefthanded": return item?.leftHanded ? 1 : 0;
            case "pulling":
            case "blocking":
            case "brushing":
            case "throwing":
            case "tooting": return item?.active ? 1 : 0;
            case "pull": return Number(item?.useProgress || 0);
            case "charged": return item?.charged ? 1 : 0;
            case "firework": return item?.firework ? 1 : 0;
            case "filled": return item?.filled ? 1 : 0;
            case "level": return Number(item?.level || 0);
            case "angle":
            case "time": return 0;
            case "cast": return item?.cast ? 1 : 0;
            case "trim_type": return Number(item?.trimType || 0);
            default: return null;
        }
    };

    const modelOverrideMatches = (predicate, item, context) => Object.entries(predicate || {})
        .every(([name, threshold]) => {
            const value = modelPredicateValue(name, item, context);
            return value !== null && value >= Number(threshold);
        });

    const resolveTextureReference = (textures, value, namespace = "minecraft") => {
        const visited = new Set();
        let current = value;
        while (typeof current === "string" && current.startsWith("#")) {
            const key = current.slice(1);
            if (!key || visited.has(key)) return null;
            visited.add(key);
            current = textures?.[key];
        }
        return normalizeResourceId(current, namespace);
    };

    const defaultFaceUv = (from, to, direction) => {
        switch (direction) {
            case "down": return [from[0], 16 - to[2], to[0], 16 - from[2]];
            case "up": return [from[0], from[2], to[0], to[2]];
            case "north": return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
            case "south": return [from[0], 16 - to[1], to[0], 16 - from[1]];
            case "west": return [from[2], 16 - to[1], to[2], 16 - from[1]];
            case "east": return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
            default: return [0, 0, 16, 16];
        }
    };

    const firstAnimationFrame = (metadata, width, height) => {
        const animation = metadata?.animation;
        if (!animation || width <= 0 || height <= 0) return null;
        const fallback = Math.min(width, height);
        const frameWidth = Number.isInteger(animation.width) && animation.width > 0
            ? animation.width
            : fallback;
        const frameHeight = Number.isInteger(animation.height) && animation.height > 0
            ? animation.height
            : frameWidth;
        if (width % frameWidth || height % frameHeight) return null;
        const columns = width / frameWidth;
        const rows = height / frameHeight;
        const first = animation.frames?.[0];
        const requested = Number(typeof first === "object" ? first?.index : first);
        const index = Number.isInteger(requested) && requested >= 0 && requested < columns * rows
            ? requested
            : 0;
        return {
            repeatX: frameWidth / width,
            repeatY: frameHeight / height,
            offsetX: (index % columns) * frameWidth / width,
            offsetY: 1 - (Math.floor(index / columns) + 1) * frameHeight / height
        };
    };

    const grayscaleRgba = pixels => {
        for (let index = 0; index + 3 < pixels.length; index += 4) {
            const gray = Math.round(
                pixels[index] * 0.2126
                + pixels[index + 1] * 0.7152
                + pixels[index + 2] * 0.0722
            );
            pixels[index] = gray;
            pixels[index + 1] = gray;
            pixels[index + 2] = gray;
        }
        return pixels;
    };

    const armorTextureKey = (itemId, layer) => {
        const path = splitId(itemId)?.path || "";
        let material = path.split("_")[0];
        if (path.startsWith("golden_")) material = "gold";
        if (path.startsWith("turtle_")) material = "turtle";
        return material
            ? `minecraft:models/armor/${material}_layer_${layer}`
            : null;
    };

    const entityFamily = type => {
        const id = splitId(type)?.path || "";
        if (/^(zombie|husk|drowned|skeleton|stray|wither_skeleton|piglin|piglin_brute|zombified_piglin|villager|wandering_trader|pillager|vindicator|evoker|illusioner|witch|enderman|iron_golem|snow_golem)$/.test(id)) return "humanoid";
        if (/^(cow|mooshroom|pig|sheep|goat|wolf|cat|fox|ocelot|rabbit|polar_bear|panda|horse|donkey|mule|llama|trader_llama|hoglin|zoglin|ravager)$/.test(id)) return "quadruped";
        if (id === "creeper") return "creeper";
        if (/spider$/.test(id)) return "spider";
        if (/^(slime|magma_cube|shulker)$/.test(id)) return "cube";
        if (/^(bee|bat|phantom|allay|vex|parrot|chicken|ghast|blaze)$/.test(id)) return "flying";
        if (/^(cod|salmon|pufferfish|tropical_fish|squid|glow_squid|dolphin|guardian|elder_guardian|axolotl|tadpole|turtle)$/.test(id)) return "aquatic";
        return "generic";
    };

    const ENTITY_TEXTURES = {
        allay: "entity/allay/allay",
        bat: "entity/bat",
        bee: "entity/bee/bee",
        blaze: "entity/blaze",
        cave_spider: "entity/spider/cave_spider",
        chicken: "entity/chicken",
        cod: "entity/fish/cod",
        cow: "entity/cow/cow",
        creeper: "entity/creeper/creeper",
        dolphin: "entity/dolphin",
        donkey: "entity/horse/donkey",
        drowned: "entity/zombie/drowned",
        elder_guardian: "entity/guardian_elder",
        enderman: "entity/enderman/enderman",
        evoker: "entity/illager/evoker",
        fox: "entity/fox/fox",
        ghast: "entity/ghast/ghast",
        glow_squid: "entity/squid/glow_squid",
        goat: "entity/goat/goat",
        guardian: "entity/guardian",
        hoglin: "entity/hoglin/hoglin",
        horse: "entity/horse/horse_brown",
        husk: "entity/zombie/husk",
        iron_golem: "entity/iron_golem/iron_golem",
        llama: "entity/llama/creamy",
        magma_cube: "entity/slime/magmacube",
        mule: "entity/horse/mule",
        ocelot: "entity/cat/ocelot",
        panda: "entity/panda/panda",
        parrot: "entity/parrot/parrot_red_blue",
        phantom: "entity/phantom",
        pig: "entity/pig/pig",
        piglin: "entity/piglin/piglin",
        piglin_brute: "entity/piglin/piglin_brute",
        pillager: "entity/illager/pillager",
        polar_bear: "entity/bear/polarbear",
        pufferfish: "entity/fish/pufferfish",
        rabbit: "entity/rabbit/brown",
        ravager: "entity/illager/ravager",
        salmon: "entity/fish/salmon",
        sheep: "entity/sheep/sheep",
        shulker: "entity/shulker/shulker",
        skeleton: "entity/skeleton/skeleton",
        slime: "entity/slime/slime",
        snow_golem: "entity/snow_golem",
        spider: "entity/spider/spider",
        squid: "entity/squid/squid",
        stray: "entity/skeleton/stray",
        turtle: "entity/turtle/big_sea_turtle",
        vex: "entity/illager/vex",
        villager: "entity/villager/villager",
        vindicator: "entity/illager/vindicator",
        wandering_trader: "entity/wandering_trader",
        witch: "entity/witch",
        wither_skeleton: "entity/skeleton/wither_skeleton",
        wolf: "entity/wolf/wolf",
        zoglin: "entity/hoglin/zoglin",
        zombie: "entity/zombie/zombie",
        zombified_piglin: "entity/piglin/zombified_piglin"
    };

    const entityTextureKeys = type => {
        const id = splitId(type);
        if (!id) return [];
        const known = id.namespace === "minecraft" && ENTITY_TEXTURES[id.path];
        return [known
            ? `minecraft:${known}`
            : `${id.namespace}:entity/${id.path}/${id.path}`];
    };

    if (globalThis.__BPM_TEST__) {
        globalThis.__BPM_TEST_API__ = {
            armorTextureKey,
            boxRegions,
            defaultFaceUv,
            entityFamily,
            entityTextureKeys,
            firstAnimationFrame,
            grayscaleRgba,
            inventoryOrder,
            interpolationSpeed,
            itemVisualKey,
            mapAssetUrl,
            minecraftSkinUrl,
            modelOverrideMatches,
            normalizeResourceId,
            normalizeInterval,
            playerDataUrl,
            resolveTextureReference,
            syncSlotNodes,
            splitId
        };
        return;
    }
    if (window.__blueMapPlayerModels) return;
    window.__blueMapPlayerModels = true;

    const start = () => {
        if (!window.bluemap?.mapViewer || !window.BlueMap?.Three) {
            requestAnimationFrame(start);
            return;
        }

        const app = window.bluemap;
        const BlueMap = window.BlueMap;
        const Three = BlueMap.Three;
        const addonRoot = new URL(
            ".",
            document.currentScript?.src || new URL("bluemap-player-models/", document.baseURI)
        ).href;
        const actorScene = new Three.Group();
        const players = new Map();
        const entities = new Map();
        const gallery = new Map();
        const textureCache = new Map();
        const modelCache = new Map();
        const modelJsonCache = new Map();
        const metadataCache = new Map();
        const itemIconCache = new Map();
        const settings = loadSettings();
        const ui = createUi();
        const panel = ui.querySelector("#bpm-panel");
        const settingsButton = ui.querySelector("#bpm-settings-button");
        let refreshRequest = null;
        let refreshTimer = null;
        let mapId = null;
        let generation = 0;
        let selectedPlayerId = null;
        let lastStatus = "";
        let resourceManifest = {generation: VERSION, models: {}, textures: {}, metadata: {}};
        let iconRenderer = null;
        const resourceReady = loadResourceManifest();
        const dueAt = {players: 0, entities: 0};

        actorScene.name = "bluemap-live-actors";
        app.mapViewer.markers.add(actorScene);
        document.getElementById("app").append(ui);
        buildSettings();

        settingsButton.addEventListener("click", () => {
            if (panel.classList.contains("bpm-open")) closePanel();
            else openPanel("settings");
        });
        ui.querySelector("#bpm-panel-close").addEventListener("click", closePanel);
        window.addEventListener("keydown", event => {
            if (event.key === "Escape" && panel.classList.contains("bpm-open")) closePanel();
        });

        function loadSettings() {
            const defaults = {
                playerModels: true,
                animatePlayers: true,
                armor: true,
                heldItems: true,
                offlinePlayers: true,
                entities: true,
                labels: true,
                playerRefreshMs: 1000,
                entityRefreshMs: 1000
            };
            try {
                const loaded = {...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")};
                loaded.playerRefreshMs = normalizeInterval(loaded.playerRefreshMs);
                loaded.entityRefreshMs = normalizeInterval(loaded.entityRefreshMs);
                return loaded;
            } catch {
                return defaults;
            }
        }

        function saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            } catch {
                // Settings still apply for this browser session.
            }
        }

        function buildSettings() {
            const definitions = [
                ["playerModels", "3D player models", "Replace BlueMap's native player heads"],
                ["animatePlayers", "Walking animation", "Animate player arms and legs"],
                ["armor", "Player armor", "Show equipped armor layers"],
                ["heldItems", "Held items", "Show main-hand and off-hand items"],
                ["offlinePlayers", "Offline players", "Keep logout positions in gray"],
                ["entities", "Entities", "Show loaded non-player entities"],
                ["labels", "Player labels", "Show skin, name, and held item"]
            ];
            const list = ui.querySelector("#bpm-settings-list");
            for (const [key, label, detail] of definitions) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "bpm-setting-row";
                button.setAttribute("role", "switch");
                button.innerHTML = `
                    <span><strong></strong><small></small></span>
                    <span class="bpm-switch" aria-hidden="true"></span>
                `;
                button.querySelector("strong").textContent = label;
                button.querySelector("small").textContent = detail;
                const update = () => {
                    button.setAttribute("aria-checked", String(settings[key]));
                    button.querySelector(".bpm-switch").classList.toggle("bpm-on", settings[key]);
                };
                button.addEventListener("click", () => {
                    settings[key] = !settings[key];
                    update();
                    saveSettings();
                    applySettings(key);
                });
                update();
                list.append(button);
            }

            const intervalList = ui.querySelector("#bpm-interval-list");
            [
                ["playerRefreshMs", "players", "Player updates", "Apply new positions and inventories"],
                ["entityRefreshMs", "entities", "Entity updates", "Apply new entity positions"]
            ].forEach(([key, target, label, detail]) => {
                const row = document.createElement("label");
                const text = document.createElement("span");
                const strong = document.createElement("strong");
                const small = document.createElement("small");
                const select = document.createElement("select");
                row.className = "bpm-setting-row bpm-select-row";
                strong.textContent = label;
                small.textContent = detail;
                text.append(strong, small);
                select.className = "bpm-setting-select";
                select.setAttribute("aria-label", label);
                REFRESH_INTERVALS.forEach(interval => {
                    const option = document.createElement("option");
                    option.value = String(interval);
                    option.textContent = `${interval / 1000}s`;
                    select.append(option);
                });
                select.value = String(settings[key]);
                select.addEventListener("change", () => {
                    settings[key] = normalizeInterval(select.value);
                    dueAt[target] = 0;
                    saveSettings();
                    queueNextRefresh();
                });
                row.append(text, select);
                intervalList.append(row);
            });
        }

        function openPanel(view, player = null) {
            app.mainMenu?.closeAll?.();
            const inventory = view === "inventory" && player;
            ui.querySelector("#bpm-settings-view").hidden = !!inventory;
            ui.querySelector("#bpm-inventory-view").hidden = !inventory;
            ui.querySelector("#bpm-panel-title").textContent = inventory
                ? `${player.name}'s inventory`
                : "Player models";
            if (inventory) renderInventory(player);
            panel.inert = false;
            panel.classList.add("bpm-open");
            panel.setAttribute("aria-hidden", "false");
            settingsButton.classList.add("bpm-active");
            ui.querySelector("#bpm-panel-close").focus();
        }

        function closePanel() {
            const wasOpen = panel.classList.contains("bpm-open");
            panel.inert = true;
            panel.classList.remove("bpm-open");
            panel.setAttribute("aria-hidden", "true");
            settingsButton.classList.remove("bpm-active");
            if (wasOpen) settingsButton.focus();
        }

        function setStatus(kind, message) {
            if (`${kind}:${message}` === lastStatus) return;
            lastStatus = `${kind}:${message}`;
            const status = ui.querySelector("#bpm-data-status");
            status.dataset.kind = kind;
            status.querySelector("span:last-child").textContent = message;
        }

        function updateCounts() {
            ui.querySelector("#bpm-player-count").textContent = String(players.size);
            ui.querySelector("#bpm-entity-count").textContent = String(entities.size);
        }

        async function optionalFetch(url) {
            const request = new AbortController();
            const timeout = setTimeout(() => request.abort(), 5000);
            try {
                return await fetch(url, {cache: "no-store", signal: request.signal});
            } finally {
                clearTimeout(timeout);
            }
        }

        async function loadResourceManifest() {
            try {
                const response = await optionalFetch(
                    `${addonRoot}resource-manifest.json?bpm=${VERSION}-${Date.now()}`
                );
                if (!response.ok) return;
                const manifest = await response.json();
                if (manifest?.format !== 1
                    || typeof manifest.generation !== "string"
                    || !manifest.models
                    || !manifest.textures) return;
                resourceManifest = manifest;
            } catch (error) {
                console.debug("BlueMap Player Models resource manifest is unavailable", error);
            }
        }

        function resourceObjectUrl(collection, resource) {
            const path = resourceManifest[collection]?.[resource];
            if (typeof path !== "string"
                || path.startsWith("/")
                || path.includes("..")
                || !/^objects\/[a-f0-9]{16,64}\.[a-z0-9.]+$/.test(path)) return null;
            return `${new URL(`resources/${path}`, addonRoot).href}?v=${resourceManifest.generation}`;
        }

        function textureUrl(resource) {
            const exported = resourceObjectUrl("textures", resource);
            if (exported) return exported;
            const id = splitId(resource);
            if (!id) return null;
            const path = id.path.split("/").map(encodeURIComponent).join("/");
            return `${addonRoot}minecraft/assets/${encodeURIComponent(id.namespace)}/textures/${path}.png`;
        }

        function modelUrl(resource) {
            return resourceObjectUrl("models", resource);
        }

        function loadTextureMetadata(resource) {
            if (!resource) return Promise.resolve(null);
            if (!metadataCache.has(resource)) {
                const url = resourceObjectUrl("metadata", resource);
                metadataCache.set(resource, url
                    ? fetch(url).then(response => response.ok ? response.json() : null).catch(() => null)
                    : Promise.resolve(null));
            }
            return metadataCache.get(resource);
        }

        function itemTextureKeys(item) {
            const id = splitId(item?.id);
            if (!id) return [];
            return [`${id.namespace}:item/${id.path}`, `${id.namespace}:block/${id.path}`];
        }

        function configureTexture(texture, flipY = texture.flipY) {
            texture.flipY = flipY;
            texture.magFilter = Three.NearestFilter;
            texture.minFilter = Three.NearestFilter;
            texture.generateMipmaps = false;
            if (Three.SRGBColorSpace) texture.colorSpace = Three.SRGBColorSpace;
            else if (Three.sRGBEncoding) texture.encoding = Three.sRGBEncoding;
            texture.needsUpdate = true;
            return texture;
        }

        function loadUrlTexture(url) {
            if (!url) return Promise.resolve(null);
            if (!textureCache.has(url)) {
                textureCache.set(url, new Promise(resolve => {
                    new Three.TextureLoader().load(
                        url,
                        texture => resolve(configureTexture(texture)),
                        undefined,
                        () => {
                            textureCache.delete(url);
                            resolve(null);
                        }
                    );
                }));
            }
            return textureCache.get(url);
        }

        async function getTexture(resources) {
            await resourceReady;
            for (const resource of resources.filter(Boolean)) {
                const source = gallery.get(resource);
                if (source) {
                    const key = `gallery:${mapId}:${resource}`;
                    if (!textureCache.has(key)) {
                        textureCache.set(
                            key,
                            Promise.resolve(configureTexture(source.clone(), true))
                        );
                    }
                    return textureCache.get(key);
                }
            }
            for (const resource of resources.filter(Boolean)) {
                const texture = await loadUrlTexture(textureUrl(resource));
                if (texture) return texture;
            }
            return null;
        }

        async function loadTextureGallery(map, token) {
            gallery.clear();
            if (!map?.data?.texturesUrl) return;
            try {
                const response = await optionalFetch(`${map.data.texturesUrl}?bpm=${VERSION}`);
                if (!response.ok) return;
                const textures = await response.json();
                if (token !== generation || !Array.isArray(textures)) return;
                textures.forEach((entry, index) => {
                    const resource = entry?.resourcePath;
                    const texture = map.hiresMaterial?.[index]?.uniforms?.textureImage?.value;
                    if (typeof resource === "string" && texture) gallery.set(resource, texture);
                });
            } catch (error) {
                console.debug("BlueMap actor texture gallery is unavailable", error);
            }
        }

        function loadModelJson(resource) {
            if (!modelJsonCache.has(resource)) {
                modelJsonCache.set(resource, (async () => {
                    const url = modelUrl(resource);
                    if (!url) return null;
                    try {
                        const response = await fetch(url);
                        if (!response.ok) return null;
                        const value = await response.json();
                        return value && typeof value === "object" ? value : null;
                    } catch {
                        return null;
                    }
                })());
            }
            return modelJsonCache.get(resource);
        }

        async function resolveModel(resource, trail) {
            if (!resource || trail.has(resource) || trail.size > 32) return null;
            const id = splitId(resource);
            if (!id) return null;
            if (id.path === "builtin/generated" || id.path === "builtin/entity") {
                return {
                    id: resource,
                    namespace: id.namespace,
                    kind: id.path.slice("builtin/".length),
                    textures: {},
                    display: {},
                    overrides: []
                };
            }

            const raw = await loadModelJson(resource);
            if (!raw) return null;
            const nextTrail = new Set(trail);
            nextTrail.add(resource);
            const parentId = normalizeResourceId(raw.parent, "minecraft");
            const parent = parentId ? await resolveModel(parentId, nextTrail) : null;
            return {
                id: resource,
                namespace: id.namespace,
                kind: parent?.kind || "elements",
                textures: {...(parent?.textures || {}), ...(raw.textures || {})},
                elements: Array.isArray(raw.elements) ? raw.elements : parent?.elements,
                display: {...(parent?.display || {}), ...(raw.display || {})},
                overrides: Array.isArray(raw.overrides) ? raw.overrides : (parent?.overrides || []),
                guiLight: raw.gui_light || parent?.guiLight || "side"
            };
        }

        function loadModel(resource) {
            if (!modelCache.has(resource)) {
                modelCache.set(resource, resolveModel(resource, new Set()));
            }
            return modelCache.get(resource);
        }

        async function resolveItemModel(item, context = {}) {
            const id = splitId(item?.id);
            if (!id) return null;
            let model = await loadModel(`${id.namespace}:item/${id.path}`);
            if (!model) return null;
            let selected = null;
            for (const override of model.overrides || []) {
                if (override?.model && modelOverrideMatches(override.predicate, item, context)) {
                    selected = normalizeResourceId(override.model, "minecraft");
                }
            }
            if (selected) model = await loadModel(selected) || model;
            return model;
        }

        function modelLayers(model) {
            return Object.keys(model?.textures || {})
                .map(key => /^layer(\d+)$/.exec(key))
                .filter(Boolean)
                .sort((left, right) => Number(left[1]) - Number(right[1]))
                .map(match => resolveTextureReference(
                    model.textures,
                    `#${match[0]}`
                ))
                .filter(Boolean);
        }

        const ITEM_UNIT = 0.035;
        const FACE_SHADE = {
            up: 1,
            down: 0.58,
            north: 0.82,
            south: 0.88,
            west: 0.72,
            east: 0.76
        };

        function itemTint(item, index) {
            return item?.tints?.[index] || (index === 0 ? item?.color : null);
        }

        function itemBuild(item) {
            return {
                item,
                root: new Three.Group(),
                materials: [],
                materialCache: new Map()
            };
        }

        function itemMaterial(build, resource, tintIndex = -1, shade = 1) {
            const tint = tintIndex >= 0 ? itemTint(build.item, tintIndex) : null;
            const key = `${resource || "missing"}|${tint || ""}|${shade}`;
            if (!build.materialCache.has(key)) {
                build.materialCache.set(key, (async () => {
                    const color = tint
                        ? new Three.Color(tint)
                        : (resource ? new Three.Color(0xffffff) : itemColor(build.item));
                    color.multiplyScalar(shade);
                    const value = material(color);
                    value.side = Three.DoubleSide;
                    value.transparent = true;
                    const [texture, metadata] = await Promise.all([
                        getTexture(resource ? [resource] : []),
                        loadTextureMetadata(resource)
                    ]);
                    if (texture) {
                        const map = configureTexture(texture.clone());
                        const width = map.image?.naturalWidth || map.image?.width || 0;
                        const height = map.image?.naturalHeight || map.image?.height || 0;
                        const frame = firstAnimationFrame(metadata, width, height);
                        if (frame) {
                            map.repeat.set(frame.repeatX, frame.repeatY);
                            map.offset.set(frame.offsetX, frame.offsetY);
                        } else if (width > 0 && height > width && height % width === 0) {
                            map.repeat.y = width / height;
                            map.offset.y = 1 - map.repeat.y;
                        }
                        map.userData = {...(map.userData || {}), bpmOwned: true};
                        value.map = map;
                        value.needsUpdate = true;
                    }
                    build.materials.push(value);
                    return value;
                })());
            }
            return build.materialCache.get(key);
        }

        function setPlaneUv(geometry, uv, rotation = 0) {
            const [left, top, right, bottom] = uv.map(Number);
            const corners = [
                [left / 16, 1 - top / 16],
                [right / 16, 1 - top / 16],
                [left / 16, 1 - bottom / 16],
                [right / 16, 1 - bottom / 16]
            ];
            const orders = {
                0: [0, 1, 2, 3],
                90: [2, 0, 3, 1],
                180: [3, 2, 1, 0],
                270: [1, 3, 0, 2]
            };
            const order = orders[((Number(rotation) % 360) + 360) % 360] || orders[0];
            const attribute = geometry.attributes.uv;
            order.forEach((corner, index) => attribute.setXY(index, ...corners[corner]));
            attribute.needsUpdate = true;
        }

        function itemFace(from, to, origin, direction) {
            const middle = from.map((value, index) => (value + to[index]) / 2);
            switch (direction) {
                case "east": return {
                    width: to[2] - from[2], height: to[1] - from[1],
                    position: [to[0], middle[1], middle[2]], rotation: [0, Math.PI / 2, 0]
                };
                case "west": return {
                    width: to[2] - from[2], height: to[1] - from[1],
                    position: [from[0], middle[1], middle[2]], rotation: [0, -Math.PI / 2, 0]
                };
                case "up": return {
                    width: to[0] - from[0], height: to[2] - from[2],
                    position: [middle[0], to[1], middle[2]], rotation: [-Math.PI / 2, 0, 0]
                };
                case "down": return {
                    width: to[0] - from[0], height: to[2] - from[2],
                    position: [middle[0], from[1], middle[2]], rotation: [Math.PI / 2, 0, 0]
                };
                case "north": return {
                    width: to[0] - from[0], height: to[1] - from[1],
                    position: [middle[0], middle[1], from[2]], rotation: [0, Math.PI, 0]
                };
                default: return {
                    width: to[0] - from[0], height: to[1] - from[1],
                    position: [middle[0], middle[1], to[2]], rotation: [0, 0, 0]
                };
            }
        }

        async function addElementModel(build, model) {
            for (const element of model.elements || []) {
                const from = Array.isArray(element?.from) ? element.from.map(Number) : null;
                const to = Array.isArray(element?.to) ? element.to.map(Number) : null;
                if (!from || !to || from.length !== 3 || to.length !== 3) continue;
                const rotation = element.rotation;
                const origin = Array.isArray(rotation?.origin) ? rotation.origin.map(Number) : [8, 8, 8];
                const pivot = new Three.Group();
                pivot.position.set(...origin.map(value => (value - 8) * ITEM_UNIT));
                for (const [direction, face] of Object.entries(element.faces || {})) {
                    if (!face?.texture) continue;
                    const descriptor = itemFace(from, to, origin, direction);
                    if (descriptor.width <= 0 || descriptor.height <= 0) continue;
                    const resource = resolveTextureReference(
                        model.textures,
                        face.texture
                    );
                    const value = await itemMaterial(
                        build,
                        resource,
                        Number.isInteger(face.tintindex) ? face.tintindex : -1,
                        element.shade === false ? 1 : (FACE_SHADE[direction] || 0.85)
                    );
                    const geometry = new Three.PlaneGeometry(
                        descriptor.width * ITEM_UNIT,
                        descriptor.height * ITEM_UNIT
                    );
                    setPlaneUv(
                        geometry,
                        Array.isArray(face.uv) ? face.uv : defaultFaceUv(from, to, direction),
                        face.rotation
                    );
                    const mesh = new Three.Mesh(geometry, value);
                    mesh.position.set(...descriptor.position.map(
                        (position, index) => (position - origin[index]) * ITEM_UNIT
                    ));
                    mesh.rotation.set(...descriptor.rotation);
                    pivot.add(mesh);
                }
                if (["x", "y", "z"].includes(rotation?.axis)
                    && Number.isFinite(Number(rotation.angle))) {
                    const angle = Three.MathUtils.degToRad(Number(rotation.angle));
                    pivot.rotation[rotation.axis] = angle;
                    if (rotation.rescale) {
                        const scale = 1 / Math.max(0.01, Math.cos(angle));
                        ["x", "y", "z"]
                            .filter(axis => axis !== rotation.axis)
                            .forEach(axis => {
                                pivot.scale[axis] = scale;
                            });
                    }
                }
                if (pivot.children.length) build.root.add(pivot);
            }
        }

        async function addGeneratedModel(build, model) {
            const layers = modelLayers(model);
            const alternatives = !layers.length;
            const resources = alternatives ? itemTextureKeys(build.item) : layers;
            let added = 0;
            for (let index = 0; index < resources.length; index++) {
                if (!await getTexture([resources[index]])) continue;
                const value = await itemMaterial(build, resources[index], index, 1);
                const mesh = new Three.Mesh(new Three.PlaneGeometry(0.56, 0.56), value);
                mesh.position.z = added++ * 0.002;
                build.root.add(mesh);
                if (alternatives) break;
            }
            if (!added) {
                const value = await itemMaterial(build, null, 0, 1);
                build.root.add(new Three.Mesh(new Three.PlaneGeometry(0.56, 0.56), value));
            }
        }

        function applyItemDisplay(root, model, context) {
            const fallbackContext = context === "thirdperson_lefthand"
                ? "thirdperson_righthand"
                : context;
            const display = model?.display?.[context] || model?.display?.[fallbackContext];
            if (!display) return;
            const rotation = Array.isArray(display.rotation) ? display.rotation : [0, 0, 0];
            const translation = Array.isArray(display.translation) ? display.translation : [0, 0, 0];
            const scale = Array.isArray(display.scale) ? display.scale : [1, 1, 1];
            root.rotation.set(...rotation.map(Three.MathUtils.degToRad));
            root.position.set(...translation.map(value => Number(value) * ITEM_UNIT));
            root.scale.set(...scale.map(Number));
        }

        async function buildItemObject(item, context = "gui") {
            const model = await resolveItemModel(item, {left: context.includes("left")});
            const build = itemBuild(item);
            if (Array.isArray(model?.elements) && model.elements.length) {
                await addElementModel(build, model);
            }
            if (!build.root.children.length) {
                await addGeneratedModel(build, model || {
                    namespace: splitId(item?.id)?.namespace || "minecraft",
                    textures: {}
                });
            }
            applyItemDisplay(build.root, model, context);
            return build;
        }

        function disposeItemObject(build) {
            build?.root?.traverse(object => object.geometry?.dispose());
            build?.materials?.forEach(value => {
                if (value.map?.userData?.bpmOwned) value.map.dispose();
                value.dispose();
            });
        }

        function renderItemIcon(build) {
            if (!build?.root?.children.length || !Three.WebGLRenderer) return null;
            if (!iconRenderer) {
                iconRenderer = new Three.WebGLRenderer({
                    alpha: true,
                    antialias: false,
                    preserveDrawingBuffer: true
                });
                iconRenderer.setPixelRatio(1);
                iconRenderer.setSize(64, 64, false);
                iconRenderer.setClearColor(0x000000, 0);
                if (Three.SRGBColorSpace) iconRenderer.outputColorSpace = Three.SRGBColorSpace;
                else if (Three.sRGBEncoding) iconRenderer.outputEncoding = Three.sRGBEncoding;
            }
            const scene = new Three.Scene();
            const camera = new Three.OrthographicCamera(-0.42, 0.42, 0.42, -0.42, 0.01, 10);
            const box = new Three.Box3().setFromObject(build.root);
            if (box.isEmpty()) return null;
            const center = box.getCenter(new Three.Vector3());
            const size = box.getSize(new Three.Vector3());
            const fit = 0.68 / Math.max(size.x, size.y, size.z, 0.01);
            build.root.position.sub(center);
            build.root.scale.multiplyScalar(fit);
            camera.position.set(0, 0, 3);
            scene.add(build.root);
            iconRenderer.render(scene, camera);
            scene.remove(build.root);
            return iconRenderer.domElement.toDataURL("image/png");
        }

        function itemIcon(item) {
            const key = itemVisualKey(item);
            if (!item || !key) return Promise.resolve(null);
            if (!itemIconCache.has(key)) {
                if (itemIconCache.size >= 512) {
                    itemIconCache.delete(itemIconCache.keys().next().value);
                }
                itemIconCache.set(key, resourceReady.then(async () => {
                    let build = null;
                    try {
                        build = await buildItemObject(item, "gui");
                        return renderItemIcon(build)
                            || itemTextureKeys(item).map(textureUrl).find(Boolean)
                            || null;
                    } catch (error) {
                        console.debug(`Failed to render item icon ${item.id}`, error);
                        return itemTextureKeys(item).map(textureUrl).find(Boolean) || null;
                    } finally {
                        disposeItemObject(build);
                    }
                }));
            }
            return itemIconCache.get(key);
        }

        function cuboidGeometry(width, height, depth, uv, textureHeight = 64) {
            const geometry = new Three.BoxGeometry(
                width * PIXEL,
                height * PIXEL,
                depth * PIXEL
            );
            const regions = boxRegions(uv[0], uv[1], width, height, depth);
            const attribute = geometry.attributes.uv;
            regions.forEach(([x, y, regionWidth, regionHeight], face) => {
                const left = x / 64;
                const right = (x + regionWidth) / 64;
                const top = 1 - y / textureHeight;
                const bottom = 1 - (y + regionHeight) / textureHeight;
                const index = face * 4;
                attribute.setXY(index, left, top);
                attribute.setXY(index + 1, right, top);
                attribute.setXY(index + 2, left, bottom);
                attribute.setXY(index + 3, right, bottom);
            });
            attribute.needsUpdate = true;
            return geometry;
        }

        function material(color, opacity = 1) {
            const result = new Three.MeshBasicMaterial({
                color,
                transparent: opacity < 1,
                opacity,
                alphaTest: 0.05
            });
            result.userData.baseColor = result.color.getHex();
            result.userData.baseOpacity = opacity;
            return result;
        }

        function addSkinPart(actor, parent, width, height, depth, baseUv, overlayUv, position) {
            const group = new Three.Group();
            const base = new Three.Mesh(
                cuboidGeometry(width, height, depth, baseUv),
                actor.baseMaterial
            );
            const overlay = new Three.Mesh(
                cuboidGeometry(width, height, depth, overlayUv),
                actor.overlayMaterial
            );
            overlay.scale.setScalar(1.055);
            overlay.visible = false;
            group.position.set(...position);
            group.add(base, overlay);
            parent.add(group);
            actor.overlayMeshes.push(overlay);
            return group;
        }

        function addLimb(actor, width, height, depth, baseUv, overlayUv, position) {
            const pivot = new Three.Group();
            pivot.position.set(...position);
            addSkinPart(
                actor,
                pivot,
                width,
                height,
                depth,
                baseUv,
                overlayUv,
                [0, -height * PIXEL / 2, 0]
            );
            actor.model.add(pivot);
            return pivot;
        }

        function currentAssetUrl(asset) {
            const path = mapAssetUrl(app.mapViewer.map?.data, asset);
            return path ? new URL(path, document.baseURI).href : null;
        }

        function createPlayerLabel(data) {
            const element = document.createElement("button");
            const head = document.createElement("img");
            const text = document.createElement("span");
            const held = document.createElement("img");
            element.type = "button";
            element.className = "bpm-player-label";
            head.className = "bpm-player-head";
            head.alt = "";
            head.draggable = false;
            head.src = currentAssetUrl(`playerheads/${data.uuid}.png`)
                || new URL("assets/steve.png", document.baseURI).href;
            head.addEventListener("error", () => {
                head.src = new URL("assets/steve.png", document.baseURI).href;
            }, {once: true});
            text.textContent = data.name;
            held.className = "bpm-player-held";
            held.alt = "";
            held.draggable = false;
            held.hidden = true;
            held.addEventListener("error", () => {
                held.hidden = true;
            });
            element.append(head, text, held);
            return element;
        }

        function skinHeadIcon(image) {
            const width = image?.naturalWidth || image?.width || 0;
            const height = image?.naturalHeight || image?.height || 0;
            if (!width || !height) return null;
            const unit = width / 64;
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) return null;
            canvas.width = 32;
            canvas.height = 32;
            context.imageSmoothingEnabled = false;
            context.drawImage(image, 8 * unit, 8 * unit, 8 * unit, 8 * unit, 0, 0, 32, 32);
            if (height >= 64 * unit) {
                context.drawImage(image, 40 * unit, 8 * unit, 8 * unit, 8 * unit, 0, 0, 32, 32);
            }
            return canvas.toDataURL("image/png");
        }

        function grayscaleTexture(source) {
            const width = source.image?.naturalWidth || source.image?.width || 0;
            const height = source.image?.naturalHeight || source.image?.height || 0;
            if (!width || !height || !Three.CanvasTexture) return null;
            try {
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", {willReadFrequently: true});
                if (!context) return null;
                canvas.width = width;
                canvas.height = height;
                context.drawImage(source.image, 0, 0, width, height);
                const image = context.getImageData(0, 0, width, height);
                grayscaleRgba(image.data);
                context.putImageData(image, 0, 0);
                return configureTexture(new Three.CanvasTexture(canvas), source.flipY);
            } catch {
                return null;
            }
        }

        function updatePlayerLabel(actor) {
            actor.label.querySelector("span").textContent = actor.data.name;
            actor.label.classList.toggle("bpm-offline", !actor.data.online);
            actor.label.classList.toggle("bpm-hidden-label", !settings.labels);
            const item = actor.data.mainHand || actor.data.offHand;
            const key = itemVisualKey(item);
            if (actor.labelHeld.dataset.itemKey === key) return;
            actor.labelHeld.dataset.itemKey = key;
            actor.labelHeld.hidden = true;
            actor.labelHeld.removeAttribute("src");
            if (!item) return;
            itemIcon(item).then(source => {
                if (!source || actor.removed || actor.labelHeld.dataset.itemKey !== key) return;
                actor.labelHeld.hidden = false;
                actor.labelHeld.src = source;
            });
        }

        function createCss2DObject(element) {
            const temporaryParent = document.createElement("div");
            temporaryParent.append(element);
            return new BlueMap.CSS2DObject(element);
        }

        function createPlayer(data) {
            const initialPosition = new Three.Vector3(data.x, data.y, data.z);
            const actor = {
                data,
                model: new Three.Group(),
                positionAnchor: new Three.Group(),
                target: initialPosition.clone(),
                sampledAt: Number(data.lastSeen) || 0,
                motionSpeed: 0,
                targetYaw: -Three.MathUtils.degToRad(data.yaw || 0),
                baseMaterial: material(0x78909c),
                overlayMaterial: material(0xffffff),
                overlayMeshes: [],
                equipmentMaterials: [],
                equipmentMeshes: [],
                armorMeshes: [],
                heldMeshes: [],
                equipmentKey: "",
                nativeMarker: null,
                followMarker: {
                    bpmPlayerId: data.uuid,
                    playerUuid: data.uuid,
                    name: data.name,
                    foreign: false,
                    position: initialPosition.clone().add(new Three.Vector3(0, 1.62, 0)),
                    rotation: {yaw: data.yaw || 0, pitch: data.pitch || 0}
                },
                lookIndicator: new Three.Group(),
                lookMaterials: [],
                skinTexture: null,
                graySkinTexture: null,
                skinReady: false,
                removed: false
            };
            actor.baseMaterial.transparent = true;
            actor.overlayMaterial.transparent = true;
            actor.overlayMaterial.depthWrite = false;
            actor.model.name = `player-model-${data.uuid}`;
            actor.positionAnchor.name = `player-${data.uuid}`;
            actor.model.onClick = event => {
                if (event.data.doubleTap) return false;
                showPlayerPopup(actor);
                return true;
            };

            const armWidth = data.slim ? 3 : 4;
            actor.head = new Three.Group();
            actor.head.position.set(0, 1.575, 0);
            addSkinPart(actor, actor.head, 8, 8, 8, [0, 0], [32, 0], [0, 0, 0]);
            actor.model.add(actor.head);

            actor.body = new Three.Group();
            actor.body.position.set(0, 1.0125, 0);
            addSkinPart(actor, actor.body, 8, 12, 4, [16, 16], [16, 32], [0, 0, 0]);
            actor.model.add(actor.body);

            actor.rightArm = addLimb(
                actor, armWidth, 12, 4, [40, 16], [40, 32],
                [(8 + armWidth) * PIXEL / -2, 1.35, 0]
            );
            actor.leftArm = addLimb(
                actor, armWidth, 12, 4, [32, 48], [48, 48],
                [(8 + armWidth) * PIXEL / 2, 1.35, 0]
            );
            actor.rightLeg = addLimb(
                actor, 4, 12, 4, [0, 16], [0, 32], [-2 * PIXEL, 0.675, 0]
            );
            actor.leftLeg = addLimb(
                actor, 4, 12, 4, [16, 48], [0, 48], [2 * PIXEL, 0.675, 0]
            );
            actor.model.rotation.y = actor.targetYaw;
            actor.head.rotation.x = Three.MathUtils.degToRad(data.pitch || 0);

            actor.label = createPlayerLabel(data);
            actor.labelHead = actor.label.querySelector(".bpm-player-head");
            actor.labelHeld = actor.label.querySelector(".bpm-player-held");
            actor.labelObject = createCss2DObject(actor.label);
            actor.labelObject.position.set(0, 2.05, 0);
            actor.model.add(actor.labelObject);

            const lookLineMaterial = new Three.LineBasicMaterial({
                color: 0x55c8ff,
                transparent: true,
                opacity: 0.9,
                depthTest: false
            });
            const lookPointMaterial = new Three.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.95,
                depthTest: false
            });
            const lookLine = new Three.Line(
                new Three.BufferGeometry().setFromPoints([
                    new Three.Vector3(),
                    new Three.Vector3(0, 0, 4)
                ]),
                lookLineMaterial
            );
            const lookPoint = new Three.Mesh(
                new Three.SphereGeometry(0.12, 8, 6),
                lookPointMaterial
            );
            lookPoint.position.z = 4;
            lookLine.renderOrder = lookPoint.renderOrder = 1000;
            actor.lookMaterials.push(lookLineMaterial, lookPointMaterial);
            actor.lookIndicator.name = `player-look-${data.uuid}`;
            actor.lookIndicator.position.y = data.crouching ? 1.27 : 1.62;
            actor.lookIndicator.rotation.order = "YXZ";
            actor.lookIndicator.visible = false;
            actor.lookIndicator.add(lookLine, lookPoint);

            actor.positionAnchor.position.copy(actor.target);
            actor.positionAnchor.add(actor.model, actor.lookIndicator);
            actorScene.add(actor.positionAnchor);
            loadSkin(actor);
            updatePlayer(actor, data);
            return actor;
        }

        async function loadSkin(actor, attempt = 0) {
            if (actor.removed) return;
            const published = currentAssetUrl(actor.data.skin);
            const source = minecraftSkinUrl(actor.data.skinUrl);
            const fingerprint = encodeURIComponent(actor.data.skin || source || "pending");
            const cached = new URL(
                `skins/${encodeURIComponent(actor.data.uuid)}.png?bpm=${VERSION}-${fingerprint}`,
                addonRoot
            ).href;
            let texture = null;
            for (const url of [...new Set([
                published ? `${published}?bpm=${VERSION}` : null,
                source,
                cached
            ].filter(Boolean))]) {
                texture = await loadUrlTexture(url);
                if (texture || actor.removed) break;
            }
            if (actor.removed) return;
            if (!texture) {
                texture = await getTexture([
                    actor.data.slim
                        ? "minecraft:entity/player/slim/alex"
                        : "minecraft:entity/player/wide/steve"
                ]);
            }
            if (!texture) {
                if (attempt < 29) setTimeout(() => loadSkin(actor, attempt + 1), 2000);
                return;
            }
            actor.skinTexture = texture;
            actor.graySkinTexture?.dispose();
            actor.graySkinTexture = grayscaleTexture(texture);
            actor.baseMaterial.userData.baseColor = 0xffffff;
            actor.overlayMaterial.userData.baseColor = 0xffffff;
            actor.overlayMeshes.forEach(mesh => {
                mesh.visible = texture.image?.height === texture.image?.width;
            });
            try {
                actor.labelHead.src = skinHeadIcon(texture.image) || actor.labelHead.src;
            } catch {
                // Keep the server-published head if the browser disallows canvas extraction.
            }
            actor.skinReady = true;
            updateTone(actor);
            applyPlayerVisibility(actor);
            app.mapViewer.redraw();
        }

        function clearNativeMarker(actor) {
            actor.nativeMarker?.element?.classList.remove("bpm-model-ready");
            actor.nativeMarker = null;
        }

        function findNativeMarker(uuid) {
            try {
                return app.playerMarkerManager?.getPlayerMarker(uuid) || null;
            } catch {
                return null;
            }
        }

        function bindPlayer(actor) {
            const marker = actor.data.online ? findNativeMarker(actor.data.uuid) : null;
            if (marker !== actor.nativeMarker) {
                clearNativeMarker(actor);
                actor.nativeMarker = marker;
            }
            actor.model.position.y = actor.data.crouching ? -0.16 : 0;
        }

        function updatePlayer(actor, data) {
            const previousSampleAt = actor.sampledAt;
            actor.data = data;
            actor.target.set(data.x, data.y, data.z);
            actor.sampledAt = Number(data.lastSeen) || previousSampleAt;
            const sampleInterval = actor.sampledAt > previousSampleAt
                ? actor.sampledAt - previousSampleAt
                : settings.playerRefreshMs;
            actor.motionSpeed = interpolationSpeed(
                actor.positionAnchor.position.distanceTo(actor.target),
                sampleInterval
            );
            actor.targetYaw = -Three.MathUtils.degToRad(data.yaw || 0);
            actor.followMarker.name = data.name;
            actor.lookIndicator.position.y = data.crouching ? 1.27 : 1.62;
            if (!data.online && isFollowing(actor)) {
                app.mapViewer.controlsManager.controls?.stopFollowingPlayerMarker?.();
            }
            updatePlayerLabel(actor);

            const equipmentKey = JSON.stringify([
                !!data.leftHanded,
                itemVisualKey(data.mainHand),
                itemVisualKey(data.offHand),
                ...(data.armor || []).map(itemVisualKey)
            ]);
            if (actor.equipmentKey !== equipmentKey) {
                actor.equipmentKey = equipmentKey;
                rebuildEquipment(actor);
            }
            bindPlayer(actor);
            updateTone(actor);
            applyPlayerVisibility(actor);
        }

        function clearEquipment(actor) {
            actor.equipmentMeshes.forEach(object => {
                object.parent?.remove(object);
                object.traverse(child => child.geometry?.dispose());
            });
            actor.equipmentMaterials.forEach(value => {
                if (value.map?.userData?.bpmOwned) value.map.dispose();
                value.dispose();
            });
            actor.equipmentMeshes = [];
            actor.equipmentMaterials = [];
            actor.armorMeshes = [];
            actor.heldMeshes = [];
        }

        function trackedEquipmentMaterial(actor, item, opacity = 1) {
            const value = material(itemColor(item), opacity);
            value.transparent = true;
            actor.equipmentMaterials.push(value);
            return value;
        }

        function addArmorMesh(actor, parent, dimensions, uv, position, value, scale = 1.08) {
            const mesh = new Three.Mesh(
                cuboidGeometry(...dimensions, uv, 32),
                value
            );
            mesh.position.set(...position);
            mesh.scale.setScalar(scale);
            parent.add(mesh);
            actor.equipmentMeshes.push(mesh);
            actor.armorMeshes.push(mesh);
        }

        function addArmorLayer(actor, item, layer, parts) {
            const value = trackedEquipmentMaterial(actor, item);
            const resource = item.armorTexture || armorTextureKey(item.id, layer);
            const key = actor.equipmentKey;
            const load = (target, textureResource, baseColor = 0xffffff) =>
                getTexture([textureResource]).then(texture => {
                    if (!texture || actor.removed || key !== actor.equipmentKey) return;
                    target.map = texture;
                    target.userData.baseColor = baseColor;
                    target.needsUpdate = true;
                    updateTone(actor);
                    app.mapViewer.redraw();
                });
            parts(value, 0);
            load(
                value,
                resource,
                item.color ? new Three.Color(item.color).getHex() : 0xffffff
            );
            if (item.armorOverlayTexture) {
                const overlay = material(0xffffff);
                overlay.transparent = true;
                actor.equipmentMaterials.push(overlay);
                parts(overlay, 0.008);
                load(overlay, item.armorOverlayTexture);
            }
            if (item.trimTexture) {
                const trim = material(0xffffff);
                trim.transparent = true;
                actor.equipmentMaterials.push(trim);
                parts(trim, 0.015);
                load(trim, item.trimTexture);
            }
        }

        function addHeldItem(actor, arm, item, left) {
            const holder = new Three.Group();
            holder.position.set(left ? -0.08 : 0.08, -0.58, -0.1);
            holder.rotation.set(-0.25, left ? -0.25 : 0.25, left ? 0.22 : -0.22);
            arm.add(holder);
            actor.equipmentMeshes.push(holder);
            actor.heldMeshes.push(holder);
            const key = actor.equipmentKey;
            resourceReady
                .then(() => buildItemObject(
                    item,
                    left ? "thirdperson_lefthand" : "thirdperson_righthand"
                ))
                .then(build => {
                    if (actor.removed || key !== actor.equipmentKey) {
                        disposeItemObject(build);
                        return;
                    }
                    holder.add(build.root);
                    actor.equipmentMaterials.push(...build.materials);
                    updateTone(actor);
                    applyPlayerVisibility(actor);
                    app.mapViewer.redraw();
                })
                .catch(error => {
                    console.debug(`Failed to render held item ${item.id}`, error);
                });
        }

        function rebuildEquipment(actor) {
            clearEquipment(actor);
            const [head, chest, legs, feet] = actor.data.armor || [];
            if (head) {
                addArmorLayer(actor, head, 1, (value, grow) => {
                    addArmorMesh(actor, actor.head, [8, 8, 8], [0, 0], [0, 0, 0], value, 1.14 + grow);
                });
            }
            if (chest) {
                addArmorLayer(actor, chest, 1, (value, grow) => {
                    addArmorMesh(actor, actor.body, [8, 12, 4], [16, 16], [0, 0, 0], value, 1.08 + grow);
                    addArmorMesh(actor, actor.rightArm, [4, 12, 4], [40, 16], [0, -6 * PIXEL, 0], value, 1.08 + grow);
                    addArmorMesh(actor, actor.leftArm, [4, 12, 4], [40, 16], [0, -6 * PIXEL, 0], value, 1.08 + grow);
                });
            }
            if (legs) {
                addArmorLayer(actor, legs, 2, (value, grow) => {
                    addArmorMesh(actor, actor.body, [8, 12, 4], [16, 16], [0, 0, 0], value, 1.04 + grow);
                    addArmorMesh(actor, actor.rightLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.08 + grow);
                    addArmorMesh(actor, actor.leftLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.08 + grow);
                });
            }
            if (feet) {
                addArmorLayer(actor, feet, 1, (value, grow) => {
                    addArmorMesh(actor, actor.rightLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.1 + grow);
                    addArmorMesh(actor, actor.leftLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.1 + grow);
                });
            }

            const mainArm = actor.data.leftHanded ? actor.leftArm : actor.rightArm;
            const offArm = actor.data.leftHanded ? actor.rightArm : actor.leftArm;
            if (actor.data.mainHand) {
                addHeldItem(actor, mainArm, actor.data.mainHand, actor.data.leftHanded);
            }
            if (actor.data.offHand) {
                addHeldItem(actor, offArm, actor.data.offHand, !actor.data.leftHanded);
            }
            applyPlayerVisibility(actor);
        }

        function itemColor(item) {
            if (item?.color) return new Three.Color(item.color);
            const id = item?.id || "";
            const known = [
                ["netherite", 0x443a42], ["diamond", 0x42d7cf], ["gold", 0xf7c843],
                ["iron", 0xd8d8d8], ["chainmail", 0x7d8589], ["turtle", 0x2fb66d],
                ["leather", 0x9b6235], ["elytra", 0x766a86]
            ].find(([name]) => id.includes(name));
            if (known) return new Three.Color(known[1]);
            let hash = 0;
            for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
            return new Three.Color().setHSL(((hash >>> 0) % 360) / 360, 0.48, 0.55);
        }

        function updateTone(actor) {
            const online = actor.data.online;
            const gray = new Three.Color(0x858b92);
            const skin = online
                ? actor.skinTexture
                : (actor.graySkinTexture || actor.skinTexture);
            [actor.baseMaterial, actor.overlayMaterial].forEach(value => {
                if (skin && value.map !== skin) {
                    value.map = skin;
                    value.needsUpdate = true;
                }
                const fallback = new Three.Color(value.userData.baseColor ?? 0x78909c);
                if (actor.skinReady) {
                    value.color.set(!online && !actor.graySkinTexture ? 0x858b92 : 0xffffff);
                } else {
                    value.color.copy(online ? fallback : fallback.lerp(gray, 0.82));
                }
                value.opacity = online ? 1 : 0.78;
            });
            actor.equipmentMaterials.forEach(value => {
                const base = new Three.Color(value.userData.baseColor ?? 0x78909c);
                value.color.copy(online ? base : base.lerp(gray, 0.82));
                value.opacity = online ? (value.userData.baseOpacity ?? 1) : 0.68;
            });
        }

        function applyPlayerVisibility(actor) {
            const show = settings.playerModels
                && (actor.data.online || settings.offlinePlayers);
            actor.model.visible = show;
            actor.positionAnchor.visible = show;
            actor.lookIndicator.visible = show && actor.data.online && isFollowing(actor);
            actor.armorMeshes.forEach(mesh => mesh.visible = settings.armor);
            actor.heldMeshes.forEach(mesh => mesh.visible = settings.heldItems);
            actor.label.classList.toggle("bpm-hidden-label", !settings.labels);
            actor.nativeMarker?.element?.classList.toggle(
                "bpm-model-ready",
                show
            );
        }

        function removePlayer(actor) {
            actor.removed = true;
            if (isFollowing(actor)) {
                app.mapViewer.controlsManager.controls?.stopFollowingPlayerMarker?.();
            }
            clearNativeMarker(actor);
            actor.model.parent?.remove(actor.model);
            actor.labelObject.parent?.remove(actor.labelObject);
            actorScene.remove(actor.positionAnchor);
            clearEquipment(actor);
            actor.model.traverse(object => object.geometry?.dispose());
            actor.lookIndicator.traverse(object => object.geometry?.dispose());
            actor.lookMaterials.forEach(value => value.dispose());
            actor.graySkinTexture?.dispose();
            actor.baseMaterial.dispose();
            actor.overlayMaterial.dispose();
            actor.label.remove();
        }

        function entityMaterial(actor) {
            let hash = 0;
            for (const character of actor.data.type) {
                hash = (hash * 31 + character.charCodeAt(0)) | 0;
            }
            const color = new Three.Color().setHSL(((hash >>> 0) % 360) / 360, 0.35, 0.58);
            const value = material(color);
            actor.materials.push(value);
            getTexture(entityTextureKeys(actor.data.type)).then(texture => {
                if (!texture || actor.removed) return;
                value.map = texture;
                value.color.set(0xffffff);
                value.userData.baseColor = 0xffffff;
                value.needsUpdate = true;
                app.mapViewer.redraw();
            });
            return value;
        }

        function addEntityBox(actor, parent, size, position, value, rotation = null) {
            const mesh = new Three.Mesh(new Three.BoxGeometry(...size), value);
            mesh.position.set(...position);
            if (rotation) mesh.rotation.set(...rotation);
            parent.add(mesh);
            actor.meshes.push(mesh);
            return mesh;
        }

        function addEntityCuboid(
            actor,
            parent,
            pixels,
            uv,
            pixelPosition,
            value,
            textureHeight = 64,
            rotation = null
        ) {
            const mesh = new Three.Mesh(
                cuboidGeometry(...pixels, uv, textureHeight),
                value
            );
            mesh.position.set(...pixelPosition.map(coordinate => coordinate * PIXEL));
            if (rotation) mesh.rotation.set(...rotation);
            parent.add(mesh);
            actor.meshes.push(mesh);
            return mesh;
        }

        function buildEntityModel(actor) {
            const group = new Three.Group();
            const value = entityMaterial(actor);
            const family = entityFamily(actor.data.type);
            let nominalWidth = 0.8;
            let nominalHeight = 1;

            if (family === "humanoid") {
                nominalWidth = 0.65;
                nominalHeight = 1.8;
                addEntityCuboid(actor, group, [8, 8, 8], [0, 0], [0, 28, 0], value);
                addEntityCuboid(actor, group, [8, 12, 4], [16, 16], [0, 18, 0], value);
                addEntityCuboid(actor, group, [4, 12, 4], [40, 16], [-6, 18, 0], value);
                addEntityCuboid(actor, group, [4, 12, 4], [40, 16], [6, 18, 0], value);
                addEntityCuboid(actor, group, [4, 12, 4], [0, 16], [-2, 6, 0], value);
                addEntityCuboid(actor, group, [4, 12, 4], [0, 16], [2, 6, 0], value);
            } else if (family === "quadruped") {
                nominalWidth = 0.9;
                nominalHeight = 1.35;
                addEntityCuboid(
                    actor, group, [10, 16, 8], [28, 8], [0, 12, 1],
                    value, 32, [Math.PI / 2, 0, 0]
                );
                addEntityCuboid(actor, group, [8, 8, 8], [0, 0], [0, 18, -10], value, 32);
                for (const x of [-3, 3]) {
                    for (const z of [-5, 6]) {
                        addEntityCuboid(actor, group, [4, 12, 4], [0, 16], [x, 6, z], value, 32);
                    }
                }
            } else if (family === "creeper") {
                nominalWidth = 8 * PIXEL;
                nominalHeight = 26 * PIXEL;
                addEntityCuboid(actor, group, [8, 8, 8], [0, 0], [0, 22, 0], value, 32);
                addEntityCuboid(actor, group, [8, 12, 4], [16, 16], [0, 12, 0], value, 32);
                for (const x of [-2, 2]) {
                    for (const z of [-2, 2]) {
                        addEntityCuboid(actor, group, [4, 6, 4], [0, 16], [x, 3, z], value, 32);
                    }
                }
            } else if (family === "spider") {
                nominalWidth = 1.4;
                nominalHeight = 0.9;
                addEntityCuboid(actor, group, [8, 8, 8], [32, 4], [0, 8, -7], value, 32);
                addEntityCuboid(actor, group, [10, 8, 12], [0, 0], [0, 8, 3], value, 32);
                addEntityCuboid(actor, group, [12, 8, 12], [0, 12], [0, 8, 15], value, 32);
                for (const side of [-1, 1]) {
                    for (let index = 0; index < 4; index++) {
                        addEntityCuboid(
                            actor, group, [16, 2, 2], [18, 0],
                            [side * 12, 8, -5 + index * 7], value, 32,
                            [0, (index - 1.5) * 0.18 * side, side * 0.22]
                        );
                    }
                }
            } else if (family === "cube") {
                nominalWidth = 1;
                nominalHeight = 1;
                addEntityBox(actor, group, [0.9, 0.9, 0.9], [0, 0.45, 0], value);
            } else if (family === "flying") {
                nominalWidth = 1;
                nominalHeight = 0.8;
                addEntityBox(actor, group, [0.62, 0.55, 0.75], [0, 0.45, 0], value);
                addEntityBox(actor, group, [0.65, 0.05, 0.45], [-0.55, 0.62, 0], value, [0, 0, 0.18]);
                addEntityBox(actor, group, [0.65, 0.05, 0.45], [0.55, 0.62, 0], value, [0, 0, -0.18]);
            } else if (family === "aquatic") {
                nominalWidth = 0.9;
                nominalHeight = 0.65;
                addEntityBox(actor, group, [0.5, 0.48, 0.9], [0, 0.38, 0], value);
                addEntityBox(actor, group, [0.08, 0.55, 0.42], [0, 0.42, 0.62], value, [0, 0, 0.1]);
            } else {
                nominalWidth = 0.8;
                nominalHeight = 1;
                addEntityBox(actor, group, [0.72, 0.9, 0.72], [0, 0.45, 0], value);
            }

            const widthScale = Math.max(0.2, actor.data.width || nominalWidth) / nominalWidth;
            const heightScale = Math.max(0.2, actor.data.height || nominalHeight) / nominalHeight;
            group.scale.set(widthScale, heightScale, widthScale);
            return group;
        }

        function createEntity(data) {
            const actor = {
                data,
                root: new Three.Group(),
                target: new Three.Vector3(data.x, data.y, data.z),
                targetYaw: -Three.MathUtils.degToRad(data.yaw || 0),
                materials: [],
                meshes: [],
                removed: false
            };
            actor.root.position.copy(actor.target);
            actor.root.rotation.y = actor.targetYaw;
            actor.root.name = `entity-${data.uuid}`;
            actor.model = buildEntityModel(actor);
            actor.root.add(actor.model);
            actor.root.onClick = event => {
                if (event.data.doubleTap) return false;
                showEntityPopup(actor);
                return true;
            };
            actorScene.add(actor.root);
            updateEntity(actor, data);
            return actor;
        }

        function updateEntity(actor, data) {
            actor.data = data;
            actor.target.set(data.x, data.y, data.z);
            actor.targetYaw = -Three.MathUtils.degToRad(data.yaw || 0);
            actor.root.visible = settings.entities;
        }

        function removeEntity(actor) {
            actor.removed = true;
            actorScene.remove(actor.root);
            actor.meshes.forEach(mesh => mesh.geometry.dispose());
            actor.materials.forEach(value => value.dispose());
        }

        function popupButton(label, action) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.addEventListener("click", action);
            return button;
        }

        function popupShell(title, subtitle, position) {
            const shell = document.createElement("div");
            const heading = document.createElement("strong");
            const detail = document.createElement("div");
            const coordinates = document.createElement("div");
            const actions = document.createElement("div");
            shell.className = "bpm-popup-content";
            detail.className = "bpm-popup-detail";
            coordinates.className = "bpm-popup-position";
            actions.className = "bpm-popup-actions";
            heading.textContent = title;
            detail.textContent = subtitle;
            coordinates.textContent = `${Math.round(position.x)} | ${Math.round(position.y)} | ${Math.round(position.z)}`;
            shell.append(heading, detail, coordinates, actions);
            return {shell, actions};
        }

        function centerOn(data) {
            const controls = app.mapViewer.controlsManager;
            controls.controls?.stopFollowingPlayerMarker?.();
            controls.position.set(data.x, data.y, data.z);
            app.mapViewer.redraw();
        }

        function isFollowing(actor) {
            return app.mapViewer.controlsManager.controls?.data?.followingPlayer?.bpmPlayerId
                === actor.data.uuid;
        }

        function openPopupAt(position, content) {
            const popup = app.popupMarker;
            if (!popup) return;
            popup.position.copy(position);
            popup.element.replaceChildren(content);
            popup.open();
            popup.cube.visible = false;
            app.mapViewer.redraw();
        }

        function showPlayerPopup(actor) {
            selectedPlayerId = actor.data.uuid;
            const data = actor.data;
            const position = actor.followMarker.position.clone();
            const subtitle = data.online
                ? "Online"
                : `Offline - ${formatLastSeen(data.lastSeen)}`;
            const {shell, actions} = popupShell(data.name, subtitle, data);
            actions.append(
                popupButton("Inventory", () => {
                    app.popupMarker?.close();
                    openPanel("inventory", players.get(selectedPlayerId)?.data || data);
                }),
                popupButton("Center", () => centerOn(actor.followMarker.position))
            );
            if (data.online) {
                actions.append(popupButton("Follow", () => {
                    app.mapViewer.controlsManager.controls?.followPlayerMarker?.(actor.followMarker);
                    applyPlayerVisibility(actor);
                    app.popupMarker?.close();
                    app.mapViewer.redraw();
                }));
            }
            openPopupAt(position, shell);
        }

        function showEntityPopup(actor) {
            const data = actor.data;
            const label = data.customName || data.name || data.type;
            const {shell, actions} = popupShell(label, data.type, data);
            actions.append(popupButton("Center", () => centerOn(data)));
            openPopupAt(actor.root.position.clone().add(new Three.Vector3(0, data.height || 1, 0)), shell);
        }

        function renderInventory(data) {
            ui.querySelector("#bpm-inventory-meta").textContent = data.online
                ? "Live snapshot"
                : `Logout snapshot - ${formatLastSeen(data.lastSeen)}`;
            const equipment = ui.querySelector("#bpm-equipment-grid");
            syncSlotNodes(equipment, [
                ["head", "Head", data.armor?.[0]], ["chest", "Chest", data.armor?.[1]],
                ["legs", "Legs", data.armor?.[2]], ["feet", "Feet", data.armor?.[3]],
                ["main", "Main hand", data.mainHand], ["off", "Off hand", data.offHand]
            ].map(([slot, name, item]) => ({
                slot: `equipment:${slot}`,
                name,
                item,
                update: element => updateInventorySlot(element, item, name)
            })), descriptor => inventorySlot(descriptor.item, descriptor.name));

            const inventory = ui.querySelector("#bpm-inventory-grid");
            syncSlotNodes(
                inventory,
                inventoryOrder(data.inventory || []).map(({item, index}) => ({
                    slot: `inventory:${index}`,
                    name: `Slot ${index + 1}`,
                    item,
                    update: element => {
                        updateInventorySlot(element, item, `Slot ${index + 1}`);
                        element.classList.toggle("bpm-hotbar", index < 9);
                        element.classList.toggle("bpm-active-slot", index === data.selectedSlot);
                    }
                })),
                descriptor => inventorySlot(descriptor.item, descriptor.name)
            );
        }

        function iconSources(item) {
            const sources = [];
            for (const key of itemTextureKeys(item)) {
                const image = gallery.get(key)?.image;
                if (image?.currentSrc || image?.src) sources.push(image.currentSrc || image.src);
                const url = textureUrl(key);
                if (url) sources.push(url);
            }
            return [...new Set(sources)];
        }

        function inventorySlot(item, slotName) {
            const element = document.createElement("div");
            element.className = "bpm-slot";
            element.setAttribute("role", "img");
            if (!item) {
                element.setAttribute("aria-label", `${slotName}: empty`);
                return element;
            }
            element.tabIndex = 0;

            const fallback = document.createElement("span");
            fallback.className = "bpm-item-fallback";
            fallback.style.setProperty("--bpm-item-color", `#${itemColor(item).getHexString()}`);
            fallback.textContent = initials(item.id);
            const image = document.createElement("img");
            image.className = "bpm-item-image";
            image.alt = "";
            image.draggable = false;
            image.addEventListener("load", () => element.classList.add("bpm-has-image"));
            itemIcon(item).then(rendered => {
                const sources = [...new Set([rendered, ...iconSources(item)].filter(Boolean))];
                let sourceIndex = 0;
                const next = () => {
                    if (sourceIndex < sources.length) image.src = sources[sourceIndex++];
                    else image.remove();
                };
                image.addEventListener("error", next);
                next();
            });

            const count = document.createElement("span");
            count.className = "bpm-item-count";
            element.append(fallback, image, count);
            if (item.maxDamage > 0) {
                const durability = document.createElement("span");
                durability.className = "bpm-durability";
                element.append(durability);
            }
            updateInventorySlot(element, item, slotName);
            return element;
        }

        function updateInventorySlot(element, item, slotName) {
            if (!item) return;
            const count = element.querySelector(".bpm-item-count");
            if (count) count.textContent = item.count > 1 ? String(item.count) : "";
            const durability = element.querySelector(".bpm-durability");
            if (durability) {
                durability.style.setProperty(
                    "--bpm-durability",
                    `${Math.max(0, 1 - item.damage / item.maxDamage) * 100}%`
                );
            }
            const durabilityText = item.maxDamage
                ? `\nDurability: ${item.maxDamage - item.damage}/${item.maxDamage}`
                : "";
            element.title = `${item.name} x${item.count}\n${item.id}${durabilityText}`;
            element.setAttribute(
                "aria-label",
                `${slotName}: ${item.name}, ${item.count}${durabilityText.replace("\n", ", ")}`
            );
            element.classList.toggle("bpm-glint", item.glint);
        }

        function reconcile(payload, update) {
            if (update.players) {
                const incomingPlayers = new Set();
                for (const data of Array.isArray(payload.players) ? payload.players : []) {
                    if (!data?.uuid) continue;
                    incomingPlayers.add(data.uuid);
                    const existing = players.get(data.uuid);
                    if (existing
                        && existing.data.slim === data.slim
                        && existing.data.skin === data.skin
                        && existing.data.skinUrl === data.skinUrl) {
                        updatePlayer(existing, data);
                    } else {
                        if (existing) removePlayer(existing);
                        players.set(data.uuid, createPlayer(data));
                    }
                }
                players.forEach((actor, id) => {
                    if (!incomingPlayers.has(id)) {
                        removePlayer(actor);
                        players.delete(id);
                    }
                });
                const inventoryView = ui.querySelector("#bpm-inventory-view");
                if (panel.classList.contains("bpm-open") && !inventoryView.hidden) {
                    const selected = players.get(selectedPlayerId)?.data;
                    if (selected) {
                        ui.querySelector("#bpm-panel-title").textContent = `${selected.name}'s inventory`;
                        renderInventory(selected);
                    } else {
                        closePanel();
                    }
                }
            }

            if (update.entities && settings.entities) {
                const incomingEntities = new Set();
                for (const data of Array.isArray(payload.entities) ? payload.entities : []) {
                    if (!data?.uuid || !data?.type) continue;
                    incomingEntities.add(data.uuid);
                    const actor = entities.get(data.uuid);
                    if (actor) updateEntity(actor, data);
                    else entities.set(data.uuid, createEntity(data));
                }
                entities.forEach((actor, id) => {
                    if (!incomingEntities.has(id)) {
                        removeEntity(actor);
                        entities.delete(id);
                    }
                });
            }
            updateCounts();
            setStatus("ok", `Connected - updated ${new Date(payload.updatedAt || Date.now()).toLocaleTimeString()}`);
            app.mapViewer.redraw();
        }

        function queueNextRefresh() {
            const next = Math.min(
                dueAt.players,
                settings.entities ? dueAt.entities : Infinity
            );
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(
                refresh,
                Number.isFinite(next) ? Math.max(0, next - Date.now()) : settings.playerRefreshMs
            );
        }

        async function refresh(force = false) {
            const dataUrl = playerDataUrl(app.mapViewer.map?.data);
            if (!dataUrl) {
                dueAt.players = Date.now() + 1000;
                dueAt.entities = dueAt.players;
                queueNextRefresh();
                return;
            }
            if (refreshRequest) return;
            const now = Date.now();
            const update = {
                players: force || now >= dueAt.players,
                entities: settings.entities && (force || now >= dueAt.entities)
            };
            if (!update.players && !update.entities) {
                queueNextRefresh();
                return;
            }
            const token = generation;
            const request = new AbortController();
            refreshRequest = request;
            try {
                const response = await fetch(
                    `${dataUrl}?bpm=${VERSION}-${Date.now()}`,
                    {cache: "no-store", signal: request.signal}
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                if (token === generation) reconcile(payload, update);
            } catch (error) {
                if (error.name !== "AbortError" && token === generation) {
                    setStatus("error", `Waiting for add-on data (${error.message})`);
                    console.debug("BlueMap Player Models data is not ready", error);
                }
            } finally {
                if (refreshRequest === request) {
                    refreshRequest = null;
                    const completed = Date.now();
                    if (update.players) dueAt.players = completed + settings.playerRefreshMs;
                    if (update.entities) dueAt.entities = completed + settings.entityRefreshMs;
                    queueNextRefresh();
                }
            }
        }

        function clearTextures() {
            textureCache.forEach(promise => promise.then(texture => texture?.dispose()));
            textureCache.clear();
            gallery.clear();
            itemIconCache.clear();
        }

        function resetForMap() {
            const nextMapId = app.mapViewer.map?.data?.id;
            mapId = nextMapId;
            generation++;
            refreshRequest?.abort();
            refreshRequest = null;
            clearTimeout(refreshTimer);
            dueAt.players = 0;
            dueAt.entities = 0;
            players.forEach(removePlayer);
            entities.forEach(removeEntity);
            players.clear();
            entities.clear();
            clearTextures();
            app.popupMarker?.close();
            closePanel();
            updateCounts();
            setStatus("waiting", "Waiting for map data");
            const token = generation;
            Promise.all([resourceReady, loadTextureGallery(app.mapViewer.map, token)]).then(() => {
                if (token === generation) app.mapViewer.redraw();
            });
            refresh(true);
        }

        function applySettings(changed) {
            players.forEach(applyPlayerVisibility);
            if (!settings.entities) {
                entities.forEach(removeEntity);
                entities.clear();
                dueAt.entities = Infinity;
                updateCounts();
            } else {
                entities.forEach(actor => actor.root.visible = true);
                if (changed === "entities") {
                    dueAt.entities = 0;
                    refresh();
                }
            }
            queueNextRefresh();
            app.mapViewer.redraw();
        }

        function animate(event) {
            const frameDelta = Math.max(0, event.detail?.delta || 50);
            const delta = Math.min(frameDelta, 100);
            const blend = 1 - Math.pow(0.001, delta / 1000);
            const now = performance.now();
            let changed = false;

            players.forEach(actor => {
                if (actor.data.online && !actor.nativeMarker) {
                    bindPlayer(actor);
                    applyPlayerVisibility(actor);
                }

                const remaining = actor.positionAnchor.position.distanceTo(actor.target);
                const moving = remaining > 0.001;
                if (moving) {
                    const step = actor.motionSpeed * frameDelta;
                    actor.positionAnchor.position.lerp(
                        actor.target,
                        Math.min(1, step / remaining)
                    );
                    changed = true;
                }

                const turn = Math.atan2(
                    Math.sin(actor.targetYaw - actor.model.rotation.y),
                    Math.cos(actor.targetYaw - actor.model.rotation.y)
                );
                actor.model.rotation.y += turn * blend;
                actor.head.rotation.x += (
                    Three.MathUtils.degToRad(actor.data.pitch || 0) - actor.head.rotation.x
                ) * blend;
                actor.followMarker.position.copy(actor.positionAnchor.position);
                actor.followMarker.position.y += actor.data.crouching ? 1.27 : 1.62;
                actor.followMarker.rotation.yaw = -Three.MathUtils.radToDeg(actor.model.rotation.y);
                actor.followMarker.rotation.pitch = Three.MathUtils.radToDeg(actor.head.rotation.x);
                actor.lookIndicator.rotation.y = actor.model.rotation.y;
                actor.lookIndicator.rotation.x = actor.head.rotation.x;
                const following = isFollowing(actor);
                if (actor.lookIndicator.visible !== following
                    && settings.playerModels
                    && actor.data.online) {
                    actor.lookIndicator.visible = following;
                    changed = true;
                }

                const walking = settings.animatePlayers
                    && actor.data.online
                    && (actor.data.moving || moving);
                const swing = walking ? Math.sin(now * 0.012) * 0.72 : 0;
                actor.rightArm.rotation.x += (swing - actor.rightArm.rotation.x) * blend;
                actor.leftArm.rotation.x += (-swing - actor.leftArm.rotation.x) * blend;
                actor.rightLeg.rotation.x += (-swing - actor.rightLeg.rotation.x) * blend;
                actor.leftLeg.rotation.x += (swing - actor.leftLeg.rotation.x) * blend;
                changed ||= walking || Math.abs(turn) > 0.001;
            });

            entities.forEach(actor => {
                actor.root.position.lerp(actor.target, blend);
                const turn = Math.atan2(
                    Math.sin(actor.targetYaw - actor.root.rotation.y),
                    Math.cos(actor.targetYaw - actor.root.rotation.y)
                );
                actor.root.rotation.y += turn * blend;
                changed ||= actor.root.position.distanceToSquared(actor.target) > 0.0001
                    || Math.abs(turn) > 0.001;
            });
            if (changed) app.mapViewer.redraw();
        }

        const initials = id => (splitId(id)?.path || "?").split("_")
            .map(part => part[0] || "")
            .join("")
            .slice(0, 2)
            .toUpperCase();

        const formatLastSeen = timestamp => new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date(timestamp));

        app.events.addEventListener("bluemapMapChanged", resetForMap);
        app.events.addEventListener("bluemapRenderFrame", animate);
        resetForMap();
        queueNextRefresh();
    };

    function createUi() {
        const ui = document.createElement("div");
        ui.id = "bpm-ui";
        ui.innerHTML = `
            <button id="bpm-settings-button" class="bpm-svg-button" type="button"
                    title="Player model settings" aria-label="Open player model settings">
                <svg viewBox="0 0 30 30" aria-hidden="true">
                    <path d="M12.7 2.5h4.6l.7 3a10 10 0 0 1 2.1.9l2.6-1.6 3.2 3.2-1.6 2.6c.4.7.7 1.4.9 2.1l3 .7V18l-3 .7a10 10 0 0 1-.9 2.1l1.6 2.6-3.2 3.2-2.6-1.6a10 10 0 0 1-2.1.9l-.7 3h-4.6l-.7-3a10 10 0 0 1-2.1-.9l-2.6 1.6-3.2-3.2 1.6-2.6a10 10 0 0 1-.9-2.1l-3-.7v-4.6l3-.7c.2-.7.5-1.4.9-2.1L4.1 8l3.2-3.2 2.6 1.6a10 10 0 0 1 2.1-.9l.7-3Zm2.3 8.2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/>
                </svg>
            </button>
            <aside id="bpm-panel" inert aria-hidden="true" aria-labelledby="bpm-panel-title">
                <button id="bpm-panel-close" class="bpm-svg-button" type="button"
                        title="Close" aria-label="Close player model panel">
                    <svg viewBox="0 0 30 30" aria-hidden="true">
                        <path d="M7.2 5 15 12.8 22.8 5 25 7.2 17.2 15l7.8 7.8-2.2 2.2-7.8-7.8L7.2 25 5 22.8l7.8-7.8L5 7.2 7.2 5Z"/>
                    </svg>
                </button>
                <div id="bpm-panel-title" class="bpm-panel-title">Player models</div>
                <div class="bpm-panel-content">
                    <section id="bpm-settings-view">
                        <div class="bpm-group">
                            <span class="bpm-group-title">Status</span>
                            <div class="bpm-group-content">
                                <div id="bpm-data-status" class="bpm-status" data-kind="waiting">
                                    <span class="bpm-status-dot"></span>
                                    <span>Waiting for map data</span>
                                </div>
                                <dl class="bpm-counts">
                                    <div><dt>Players</dt><dd id="bpm-player-count">0</dd></div>
                                    <div><dt>Entities</dt><dd id="bpm-entity-count">0</dd></div>
                                </dl>
                            </div>
                        </div>
                        <div class="bpm-group">
                            <span class="bpm-group-title">Map display</span>
                            <div id="bpm-settings-list" class="bpm-group-content"></div>
                        </div>
                        <div class="bpm-group">
                            <span class="bpm-group-title">Update intervals</span>
                            <div id="bpm-interval-list" class="bpm-group-content"></div>
                        </div>
                    </section>
                    <section id="bpm-inventory-view" hidden>
                        <p id="bpm-inventory-meta" class="bpm-inventory-meta"></p>
                        <div class="bpm-group">
                            <span class="bpm-group-title">Equipment</span>
                            <div id="bpm-equipment-grid" class="bpm-equipment-grid bpm-group-content"></div>
                        </div>
                        <div class="bpm-group">
                            <span class="bpm-group-title">Inventory</span>
                            <div id="bpm-inventory-grid" class="bpm-inventory-grid bpm-group-content"></div>
                        </div>
                    </section>
                </div>
            </aside>
        `;
        return ui;
    }

    start();
})();

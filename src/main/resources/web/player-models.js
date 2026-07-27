(() => {
    "use strict";

    const VERSION = "1.1.1";
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

    const normalizeInterval = value => {
        const interval = Number(value);
        return REFRESH_INTERVALS.includes(interval) ? interval : 1000;
    };

    const splitId = id => {
        const match = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(id || "");
        return match ? {namespace: match[1], path: match[2]} : null;
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
            entityFamily,
            entityTextureKeys,
            inventoryOrder,
            mapAssetUrl,
            normalizeInterval,
            playerDataUrl,
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
                ["labels", "Offline labels", "Show names beside logout positions"]
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

        function textureUrl(resource) {
            const id = splitId(resource);
            if (!id) return null;
            const path = id.path.split("/").map(encodeURIComponent).join("/");
            return `${addonRoot}minecraft/assets/${encodeURIComponent(id.namespace)}/textures/${path}.png`;
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
                const response = await fetch(
                    `${map.data.texturesUrl}?bpm=${VERSION}`,
                    {cache: "no-store"}
                );
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

        function createOfflineLabel(data) {
            const element = document.createElement("button");
            const image = document.createElement("img");
            const text = document.createElement("span");
            element.type = "button";
            element.className = "bpm-offline-label";
            image.alt = "";
            image.draggable = false;
            image.src = currentAssetUrl(`playerheads/${data.uuid}.png`)
                || new URL("assets/steve.png", document.baseURI).href;
            image.addEventListener("error", () => {
                image.src = new URL("assets/steve.png", document.baseURI).href;
            }, {once: true});
            text.textContent = data.name;
            element.append(image, text);
            return element;
        }

        function createCss2DObject(element) {
            const temporaryParent = document.createElement("div");
            temporaryParent.append(element);
            return new BlueMap.CSS2DObject(element);
        }

        function createPlayer(data) {
            const actor = {
                data,
                model: new Three.Group(),
                offlineAnchor: new Three.Group(),
                target: new Three.Vector3(data.x, data.y, data.z),
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
                lastNativePosition: new Three.Vector3(),
                movementUntil: 0,
                skinReady: false,
                removed: false
            };
            actor.baseMaterial.transparent = true;
            actor.overlayMaterial.transparent = true;
            actor.overlayMaterial.depthWrite = false;
            actor.model.name = `player-model-${data.uuid}`;
            actor.offlineAnchor.name = `offline-player-${data.uuid}`;
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

            actor.label = createOfflineLabel(data);
            actor.label.addEventListener("click", () => showPlayerPopup(actor));
            actor.labelObject = createCss2DObject(actor.label);
            actor.labelObject.position.set(0, 2.05, 0);
            actor.offlineAnchor.add(actor.labelObject);
            actor.offlineAnchor.position.copy(actor.target);
            actor.offlineAnchor.add(actor.model);
            actorScene.add(actor.offlineAnchor);
            loadSkin(actor);
            updatePlayer(actor, data);
            return actor;
        }

        async function loadSkin(actor, attempt = 0) {
            const source = currentAssetUrl(actor.data.skin);
            if (!source) return;
            const url = `${source}?bpm=${VERSION}`;
            const texture = await loadUrlTexture(url);
            if (actor.removed) return;
            if (!texture) {
                if (attempt < 9) setTimeout(() => loadSkin(actor, attempt + 1), 2000);
                return;
            }
            actor.baseMaterial.map = texture;
            actor.overlayMaterial.map = texture;
            actor.baseMaterial.userData.baseColor = 0xffffff;
            actor.overlayMaterial.userData.baseColor = 0xffffff;
            actor.baseMaterial.needsUpdate = true;
            actor.overlayMaterial.needsUpdate = true;
            actor.overlayMeshes.forEach(mesh => mesh.visible = texture.image?.height === 64);
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
            if (!actor.data.online) {
                clearNativeMarker(actor);
                if (actor.model.parent !== actor.offlineAnchor) {
                    actor.model.parent?.remove(actor.model);
                    actor.offlineAnchor.add(actor.model);
                }
                actor.model.position.y = 0;
                return;
            }

            const marker = findNativeMarker(actor.data.uuid);
            if (marker !== actor.nativeMarker) {
                clearNativeMarker(actor);
                actor.nativeMarker = marker;
                if (marker) {
                    actor.model.parent?.remove(actor.model);
                    marker.add(actor.model);
                    actor.lastNativePosition.copy(marker.position);
                }
            }
            actor.model.position.y = -1.8 - (actor.data.crouching ? 0.16 : 0);
        }

        function updatePlayer(actor, data) {
            const wasOnline = actor.data.online;
            actor.data = data;
            actor.target.set(data.x, data.y, data.z);
            actor.targetYaw = -Three.MathUtils.degToRad(data.yaw || 0);
            if (data.online || wasOnline) actor.offlineAnchor.position.copy(actor.target);
            actor.label.querySelector("span").textContent = data.name;
            actor.label.classList.toggle("bpm-hidden-label", !settings.labels);

            const equipmentKey = JSON.stringify([
                data.mainHand?.id,
                data.offHand?.id,
                ...(data.armor || []).flatMap(item => [item?.id, item?.color])
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
            actor.equipmentMeshes.forEach(mesh => {
                mesh.parent?.remove(mesh);
                mesh.geometry.dispose();
            });
            actor.equipmentMaterials.forEach(value => value.dispose());
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
            const resource = armorTextureKey(item.id, layer);
            const key = actor.equipmentKey;
            parts(value);
            getTexture([resource]).then(texture => {
                if (!texture || actor.removed || key !== actor.equipmentKey) return;
                value.map = texture;
                value.userData.baseColor = item.color ? new Three.Color(item.color).getHex() : 0xffffff;
                value.needsUpdate = true;
                updateTone(actor);
                app.mapViewer.redraw();
            });
        }

        function addHeldItem(actor, arm, item, left) {
            const value = trackedEquipmentMaterial(actor, item);
            value.side = Three.DoubleSide;
            const mesh = new Three.Mesh(new Three.PlaneGeometry(0.45, 0.45), value);
            mesh.position.set(left ? -0.08 : 0.08, -0.58, -0.1);
            mesh.rotation.set(-0.25, left ? -0.25 : 0.25, left ? 0.22 : -0.22);
            arm.add(mesh);
            actor.equipmentMeshes.push(mesh);
            actor.heldMeshes.push(mesh);
            const key = actor.equipmentKey;
            getTexture(itemTextureKeys(item)).then(texture => {
                if (!texture || actor.removed || key !== actor.equipmentKey) return;
                value.map = texture;
                value.userData.baseColor = 0xffffff;
                value.needsUpdate = true;
                updateTone(actor);
                app.mapViewer.redraw();
            });
        }

        function rebuildEquipment(actor) {
            clearEquipment(actor);
            const [head, chest, legs, feet] = actor.data.armor || [];
            if (head) {
                addArmorLayer(actor, head, 1, value => {
                    addArmorMesh(actor, actor.head, [8, 8, 8], [0, 0], [0, 0, 0], value, 1.14);
                });
            }
            if (chest) {
                addArmorLayer(actor, chest, 1, value => {
                    addArmorMesh(actor, actor.body, [8, 12, 4], [16, 16], [0, 0, 0], value);
                    addArmorMesh(actor, actor.rightArm, [4, 12, 4], [40, 16], [0, -6 * PIXEL, 0], value);
                    addArmorMesh(actor, actor.leftArm, [4, 12, 4], [40, 16], [0, -6 * PIXEL, 0], value);
                });
            }
            if (legs) {
                addArmorLayer(actor, legs, 2, value => {
                    addArmorMesh(actor, actor.body, [8, 12, 4], [16, 16], [0, 0, 0], value, 1.04);
                    addArmorMesh(actor, actor.rightLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value);
                    addArmorMesh(actor, actor.leftLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value);
                });
            }
            if (feet) {
                addArmorLayer(actor, feet, 1, value => {
                    addArmorMesh(actor, actor.rightLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.1);
                    addArmorMesh(actor, actor.leftLeg, [4, 12, 4], [0, 16], [0, -6 * PIXEL, 0], value, 1.1);
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
            [actor.baseMaterial, actor.overlayMaterial, ...actor.equipmentMaterials]
                .forEach(value => {
                    const base = new Three.Color(value.userData.baseColor ?? 0x78909c);
                    value.color.copy(online ? base : base.lerp(gray, 0.82));
                    value.opacity = online ? (value.userData.baseOpacity ?? 1) : 0.68;
                });
        }

        function applyPlayerVisibility(actor) {
            const show = settings.playerModels
                && (actor.data.online || settings.offlinePlayers);
            const onlineReady = !!actor.nativeMarker;
            actor.model.visible = show && (!actor.data.online || onlineReady);
            actor.offlineAnchor.visible = show && !actor.data.online;
            actor.armorMeshes.forEach(mesh => mesh.visible = settings.armor);
            actor.heldMeshes.forEach(mesh => mesh.visible = settings.heldItems);
            actor.label.classList.toggle("bpm-hidden-label", !settings.labels);
            actor.nativeMarker?.element?.classList.toggle(
                "bpm-model-ready",
                show && onlineReady
            );
        }

        function removePlayer(actor) {
            actor.removed = true;
            clearNativeMarker(actor);
            actor.model.parent?.remove(actor.model);
            actor.offlineAnchor.remove(actor.labelObject);
            actorScene.remove(actor.offlineAnchor);
            actor.model.traverse(object => object.geometry?.dispose());
            actor.baseMaterial.dispose();
            actor.overlayMaterial.dispose();
            actor.equipmentMaterials.forEach(value => value.dispose());
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
            const position = actor.nativeMarker
                ? actor.nativeMarker.position.clone()
                : actor.offlineAnchor.position.clone().add(new Three.Vector3(0, 0.8, 0));
            const subtitle = data.online
                ? "Online"
                : `Offline - ${formatLastSeen(data.lastSeen)}`;
            const {shell, actions} = popupShell(data.name, subtitle, data);
            actions.append(
                popupButton("Inventory", () => {
                    app.popupMarker?.close();
                    openPanel("inventory", players.get(selectedPlayerId)?.data || data);
                }),
                popupButton("Center", () => centerOn(data))
            );
            if (data.online && actor.nativeMarker) {
                actions.append(popupButton("Follow", () => {
                    app.mapViewer.controlsManager.controls?.followPlayerMarker?.(actor.nativeMarker);
                    app.popupMarker?.close();
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
            equipment.replaceChildren();
            [
                ["Head", data.armor?.[0]], ["Chest", data.armor?.[1]],
                ["Legs", data.armor?.[2]], ["Feet", data.armor?.[3]],
                ["Main hand", data.mainHand], ["Off hand", data.offHand]
            ].forEach(([name, item]) => equipment.append(inventorySlot(item, name)));

            const inventory = ui.querySelector("#bpm-inventory-grid");
            inventory.replaceChildren();
            inventoryOrder(data.inventory || []).forEach(({item, index}) => {
                const element = inventorySlot(item, `Slot ${index + 1}`);
                element.classList.toggle("bpm-hotbar", index < 9);
                element.classList.toggle("bpm-active-slot", index === data.selectedSlot);
                inventory.append(element);
            });
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
            const sources = iconSources(item);
            let sourceIndex = 0;
            image.addEventListener("load", () => element.classList.add("bpm-has-image"));
            image.addEventListener("error", () => {
                if (sourceIndex < sources.length) image.src = sources[sourceIndex++];
                else image.remove();
            });
            if (sources.length) image.src = sources[sourceIndex++];
            else image.remove();

            const count = document.createElement("span");
            count.className = "bpm-item-count";
            count.textContent = item.count > 1 ? String(item.count) : "";
            element.append(fallback, image, count);
            if (item.maxDamage > 0) {
                const durability = document.createElement("span");
                durability.className = "bpm-durability";
                durability.style.setProperty(
                    "--bpm-durability",
                    `${Math.max(0, 1 - item.damage / item.maxDamage) * 100}%`
                );
                element.append(durability);
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
            return element;
        }

        function reconcile(payload, update) {
            if (update.players) {
                const incomingPlayers = new Set();
                for (const data of Array.isArray(payload.players) ? payload.players : []) {
                    if (!data?.uuid) continue;
                    incomingPlayers.add(data.uuid);
                    const existing = players.get(data.uuid);
                    if (existing && existing.data.slim === data.slim && existing.data.skin === data.skin) {
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
            loadTextureGallery(app.mapViewer.map, token).then(() => {
                if (token === generation) refresh(true);
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
            const delta = Math.min(event.detail?.delta || 50, 100);
            const blend = 1 - Math.pow(0.001, delta / 1000);
            const now = performance.now();
            let changed = false;

            players.forEach(actor => {
                if (actor.data.online) {
                    if (!actor.nativeMarker || actor.model.parent !== actor.nativeMarker) {
                        bindPlayer(actor);
                        applyPlayerVisibility(actor);
                    }
                    if (actor.nativeMarker) {
                        const distance = actor.nativeMarker.position.distanceToSquared(actor.lastNativePosition);
                        if (distance > 0.000001 && distance < 16) actor.movementUntil = now + 180;
                        actor.lastNativePosition.copy(actor.nativeMarker.position);
                        actor.targetYaw = -Three.MathUtils.degToRad(
                            actor.nativeMarker.data.rotation?.yaw ?? actor.data.yaw ?? 0
                        );
                    }
                } else {
                    actor.offlineAnchor.position.lerp(actor.target, blend);
                    changed ||= actor.offlineAnchor.position.distanceToSquared(actor.target) > 0.0001;
                }

                const turn = Math.atan2(
                    Math.sin(actor.targetYaw - actor.model.rotation.y),
                    Math.cos(actor.targetYaw - actor.model.rotation.y)
                );
                actor.model.rotation.y += turn * blend;
                actor.head.rotation.x += (
                    Three.MathUtils.degToRad(actor.data.pitch || 0) - actor.head.rotation.x
                ) * blend;

                const walking = settings.animatePlayers
                    && actor.data.online
                    && (actor.data.moving || now < actor.movementUntil);
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

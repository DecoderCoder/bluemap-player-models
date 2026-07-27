(() => {
    "use strict";

    const PIXEL = 0.05625;
    const DATA_ASSET = "assets/bluemap-player-models/players.json";

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

    if (globalThis.__BPM_TEST__) {
        globalThis.__BPM_TEST_API__ = {boxRegions, inventoryOrder, playerDataUrl};
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
        const Three = window.BlueMap.Three;
        const scene = new Three.Group();
        const actors = new Map();
        let selectedId = null;
        let loading = false;
        let mapId = null;

        scene.name = "bluemap-player-models";
        app.mapViewer.markers.add(scene);

        const ui = createUi();
        const card = ui.querySelector("#bpm-player-card");
        const dialog = ui.querySelector("#bpm-inventory");
        document.getElementById("app").append(ui);

        ui.querySelector("#bpm-deselect").addEventListener("click", () => select(null));
        ui.querySelector("#bpm-open-inventory").addEventListener("click", openInventory);
        dialog.addEventListener("click", event => {
            if (event.target === dialog) dialog.close();
        });

        const select = id => {
            selectedId = id;
            actors.forEach(actor => actor.label.classList.toggle("bpm-selected", actor.data.uuid === id));
            const actor = actors.get(id);
            card.hidden = !actor;
            if (actor) updateCard(actor.data);
            app.mapViewer.redraw();
        };

        function createActor(data) {
            const actor = {
                data,
                root: new Three.Group(),
                target: new Three.Vector3(data.x, data.y - (data.crouching ? 0.16 : 0), data.z),
                targetYaw: -Three.MathUtils.degToRad(data.yaw),
                baseMaterial: new Three.MeshBasicMaterial({
                    color: 0x78909c,
                    transparent: true,
                    alphaTest: 0.05
                }),
                overlayMaterial: new Three.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    alphaTest: 0.05,
                    depthWrite: false
                }),
                skinMeshes: [],
                overlayMeshes: [],
                uvGeometries: [],
                equipmentMeshes: [],
                equipmentMaterials: [],
                equipmentKey: "",
                skinRetries: 0,
                removed: false
            };

            actor.root.name = `player-${data.uuid}`;
            actor.root.position.copy(actor.target);
            actor.root.rotation.y = actor.targetYaw;
            actor.root.onClick = () => {
                select(data.uuid);
                return true;
            };

            const armWidth = data.slim ? 3 : 4;
            addSkinPart(actor, actor.root, 8, 8, 8, [0, 0], [32, 0], [0, 1.575, 0]);
            addSkinPart(actor, actor.root, 8, 12, 4, [16, 16], [16, 32], [0, 1.0125, 0]);

            actor.rightArm = addLimb(
                actor, armWidth, 12, 4, [40, 16], [40, 32],
                [(8 + armWidth) * PIXEL / -2, 1.35, 0]
            );
            actor.leftArm = addLimb(
                actor, armWidth, 12, 4, [32, 48], [48, 48],
                [(8 + armWidth) * PIXEL / 2, 1.35, 0]
            );
            actor.rightLeg = addLimb(actor, 4, 12, 4, [0, 16], [0, 32], [-2 * PIXEL, 0.675, 0]);
            actor.leftLeg = addLimb(actor, 4, 12, 4, [16, 48], [0, 48], [2 * PIXEL, 0.675, 0]);

            actor.label = document.createElement("div");
            actor.label.className = "bpm-player-label";
            actor.labelObject = new window.BlueMap.CSS2DObject(actor.label);
            actor.labelObject.position.set(0, 2.12, 0);
            actor.root.add(actor.labelObject);

            scene.add(actor.root);
            loadSkin(actor);
            updateActor(actor, data);
            return actor;
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
            actor.root.add(pivot);
            return pivot;
        }

        function addSkinPart(actor, parent, width, height, depth, baseUv, overlayUv, position) {
            const group = new Three.Group();
            const baseGeometry = skinGeometry(width, height, depth, baseUv);
            const overlayGeometry = skinGeometry(width, height, depth, overlayUv);
            const base = new Three.Mesh(baseGeometry, actor.baseMaterial);
            const overlay = new Three.Mesh(overlayGeometry, actor.overlayMaterial);

            overlay.scale.setScalar(1.055);
            overlay.visible = false;
            group.position.set(...position);
            group.add(base, overlay);
            parent.add(group);

            actor.skinMeshes.push(base);
            actor.overlayMeshes.push(overlay);
            actor.uvGeometries.push(
                {geometry: baseGeometry, width, height, depth, uv: baseUv},
                {geometry: overlayGeometry, width, height, depth, uv: overlayUv}
            );
        }

        function skinGeometry(width, height, depth, uv) {
            const geometry = new Three.BoxGeometry(width * PIXEL, height * PIXEL, depth * PIXEL);
            applyBoxUv(geometry, boxRegions(uv[0], uv[1], width, height, depth));
            return geometry;
        }

        function applyBoxUv(geometry, regions) {
            const uv = geometry.attributes.uv;
            regions.forEach(([x, y, width, height], face) => {
                const left = x / 64;
                const right = (x + width) / 64;
                const top = 1 - y / 64;
                const bottom = 1 - (y + height) / 64;
                const index = face * 4;
                uv.setXY(index, left, top);
                uv.setXY(index + 1, right, top);
                uv.setXY(index + 2, left, bottom);
                uv.setXY(index + 3, right, bottom);
            });
            uv.needsUpdate = true;
        }

        function loadSkin(actor) {
            new Three.TextureLoader().load(
                actor.data.skin,
                texture => {
                    texture.magFilter = Three.NearestFilter;
                    texture.minFilter = Three.NearestFilter;
                    if (Three.SRGBColorSpace) texture.colorSpace = Three.SRGBColorSpace;
                    actor.texture = texture;
                    actor.baseMaterial.map = texture;
                    actor.overlayMaterial.map = texture;
                    actor.baseMaterial.userData.baseColor = 0xffffff;
                    actor.overlayMaterial.userData.baseColor = 0xffffff;
                    actor.baseMaterial.needsUpdate = true;
                    actor.overlayMaterial.needsUpdate = true;
                    actor.overlayMeshes.forEach(mesh => mesh.visible = texture.image?.height === 64);
                    updateTone(actor);
                    app.mapViewer.redraw();
                },
                undefined,
                () => {
                    if (!actor.removed && ++actor.skinRetries < 10) {
                        setTimeout(() => loadSkin(actor), 2000);
                    }
                }
            );
        }

        function updateActor(actor, data) {
            actor.data = data;
            actor.target.set(data.x, data.y - (data.crouching ? 0.16 : 0), data.z);
            actor.targetYaw = -Three.MathUtils.degToRad(data.yaw);
            actor.label.replaceChildren(statusDot(data.online), document.createTextNode(data.name));
            actor.label.classList.toggle("bpm-offline", !data.online);

            const equipmentKey = JSON.stringify([
                data.mainHand?.id, data.offHand?.id,
                ...(data.armor || []).flatMap(item => [item?.id, item?.color])
            ]);
            if (actor.equipmentKey !== equipmentKey) {
                actor.equipmentKey = equipmentKey;
                rebuildEquipment(actor);
            }
            updateTone(actor);
            if (selectedId === data.uuid) updateCard(data);
        }

        function rebuildEquipment(actor) {
            actor.equipmentMeshes.forEach(mesh => {
                mesh.parent?.remove(mesh);
                mesh.geometry.dispose();
            });
            actor.equipmentMaterials.forEach(material => material.dispose());
            actor.equipmentMeshes = [];
            actor.equipmentMaterials = [];

            const [head, chest, legs, feet] = actor.data.armor || [];
            if (head) addEquipment(actor, actor.root, [0.49, 0.49, 0.49], [0, 1.575, 0], head, 0.62);
            if (chest) addEquipment(actor, actor.root, [0.49, 0.72, 0.27], [0, 1.0125, 0], chest, 0.7);
            if (legs) {
                addEquipment(actor, actor.rightLeg, [0.25, 0.5, 0.25], [0, -0.25, 0], legs, 0.66);
                addEquipment(actor, actor.leftLeg, [0.25, 0.5, 0.25], [0, -0.25, 0], legs, 0.66);
            }
            if (feet) {
                addEquipment(actor, actor.rightLeg, [0.26, 0.28, 0.3], [0, -0.54, 0.025], feet, 0.82);
                addEquipment(actor, actor.leftLeg, [0.26, 0.28, 0.3], [0, -0.54, 0.025], feet, 0.82);
            }

            const mainArm = actor.data.leftHanded ? actor.leftArm : actor.rightArm;
            const offArm = actor.data.leftHanded ? actor.rightArm : actor.leftArm;
            if (actor.data.mainHand) addHeldItem(actor, mainArm, actor.data.mainHand, actor.data.leftHanded);
            if (actor.data.offHand) addHeldItem(actor, offArm, actor.data.offHand, !actor.data.leftHanded);
        }

        function addEquipment(actor, parent, size, position, item, opacity) {
            const material = solidMaterial(actor, item, opacity);
            const mesh = new Three.Mesh(new Three.BoxGeometry(...size), material);
            mesh.position.set(...position);
            parent.add(mesh);
            actor.equipmentMeshes.push(mesh);
        }

        function addHeldItem(actor, arm, item, left) {
            // ponytail: a colored silhouette shows any item without shipping Minecraft's full item-model pipeline.
            const material = solidMaterial(actor, item, 0.95);
            const mesh = new Three.Mesh(new Three.BoxGeometry(0.08, 0.4, 0.2), material);
            mesh.position.set(left ? -0.09 : 0.09, -0.58, -0.1);
            mesh.rotation.z = left ? 0.18 : -0.18;
            arm.add(mesh);
            actor.equipmentMeshes.push(mesh);
        }

        function solidMaterial(actor, item, opacity) {
            const material = new Three.MeshBasicMaterial({
                color: itemColor(item),
                transparent: true,
                opacity
            });
            material.userData.baseColor = material.color.getHex();
            material.userData.baseOpacity = opacity;
            actor.equipmentMaterials.push(material);
            return material;
        }

        function itemColor(item) {
            if (item.color) return new Three.Color(item.color);
            const id = item.id || "";
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
            const materials = [actor.baseMaterial, actor.overlayMaterial, ...actor.equipmentMaterials];
            materials.forEach(material => {
                const base = new Three.Color(material.userData.baseColor ?? 0x78909c);
                material.color.copy(online ? base : base.lerp(gray, 0.82));
                material.opacity = online ? (material.userData.baseOpacity ?? 1) : 0.68;
            });
        }

        function removeActor(actor) {
            actor.removed = true;
            scene.remove(actor.root);
            actor.root.traverse(object => object.geometry?.dispose());
            actor.baseMaterial.dispose();
            actor.overlayMaterial.dispose();
            actor.equipmentMaterials.forEach(material => material.dispose());
            actor.texture?.dispose();
            actor.label.remove();
        }

        function reconcile(payload) {
            const incoming = new Set();
            for (const data of payload.players || []) {
                incoming.add(data.uuid);
                const actor = actors.get(data.uuid);
                if (actor) updateActor(actor, data);
                else actors.set(data.uuid, createActor(data));
            }
            actors.forEach((actor, id) => {
                if (!incoming.has(id)) {
                    removeActor(actor);
                    actors.delete(id);
                    if (selectedId === id) select(null);
                }
            });
            app.mapViewer.redraw();
        }

        async function refresh() {
            const map = app.mapViewer.map;
            const dataUrl = playerDataUrl(map?.data);
            if (!dataUrl || loading) return;
            loading = true;
            try {
                const response = await fetch(
                    `${dataUrl}?v=${Date.now()}`,
                    {cache: "no-store"}
                );
                if (response.ok) reconcile(await response.json());
            } catch (error) {
                console.debug("BlueMap Player Models data is not ready", error);
            } finally {
                loading = false;
            }
        }

        function resetForMap() {
            const nextMapId = app.mapViewer.map?.data?.id;
            if (nextMapId === mapId) return;
            mapId = nextMapId;
            actors.forEach(removeActor);
            actors.clear();
            select(null);
            refresh();
        }

        function animate(event) {
            const delta = Math.min(event.detail?.delta || 50, 100);
            const blend = 1 - Math.pow(0.001, delta / 1000);
            const now = performance.now();
            let moving = false;

            actors.forEach(actor => {
                actor.root.position.lerp(actor.target, blend);
                const turn = Math.atan2(
                    Math.sin(actor.targetYaw - actor.root.rotation.y),
                    Math.cos(actor.targetYaw - actor.root.rotation.y)
                );
                actor.root.rotation.y += turn * blend;

                const walking = actor.data.online && actor.data.moving;
                const swing = walking ? Math.sin(now * 0.012) * 0.72 : 0;
                actor.rightArm.rotation.x += (swing - actor.rightArm.rotation.x) * blend;
                actor.leftArm.rotation.x += (-swing - actor.leftArm.rotation.x) * blend;
                actor.rightLeg.rotation.x += (-swing - actor.rightLeg.rotation.x) * blend;
                actor.leftLeg.rotation.x += (swing - actor.leftLeg.rotation.x) * blend;
                moving ||= walking || actor.root.position.distanceToSquared(actor.target) > 0.0001;
            });

            if (moving) app.mapViewer.redraw();
        }

        function updateCard(data) {
            ui.querySelector("#bpm-player-name").textContent = data.name;
            ui.querySelector("#bpm-player-status").replaceChildren(
                statusDot(data.online),
                document.createTextNode(data.online ? "Online" : `Offline · ${formatLastSeen(data.lastSeen)}`)
            );
            ui.querySelector("#bpm-player-position").textContent =
                `${Math.round(data.x)}, ${Math.round(data.y)}, ${Math.round(data.z)}`;
            ui.querySelector("#bpm-player-held").textContent =
                data.mainHand ? `${data.mainHand.name} ×${data.mainHand.count}` : "Empty hand";
        }

        function openInventory() {
            const data = actors.get(selectedId)?.data;
            if (!data) return;

            ui.querySelector("#bpm-inventory-title").textContent = `${data.name}'s inventory`;
            ui.querySelector("#bpm-inventory-meta").textContent =
                data.online ? "Live snapshot" : `Logout snapshot · ${formatLastSeen(data.lastSeen)}`;

            const equipment = ui.querySelector("#bpm-equipment-grid");
            equipment.replaceChildren();
            [
                ["Head", data.armor?.[0]], ["Chest", data.armor?.[1]],
                ["Legs", data.armor?.[2]], ["Feet", data.armor?.[3]],
                ["Main hand", data.mainHand], ["Off hand", data.offHand]
            ].forEach(([name, item]) => equipment.append(slot(item, name)));

            const inventory = ui.querySelector("#bpm-inventory-grid");
            inventory.replaceChildren();
            inventoryOrder(data.inventory || []).forEach(({item, index}) => {
                const element = slot(item, `Slot ${index + 1}`);
                element.classList.toggle("bpm-hotbar", index < 9);
                element.classList.toggle("bpm-active-slot", index === data.selectedSlot);
                inventory.append(element);
            });
            dialog.showModal();
        }

        function slot(item, slotName) {
            const element = document.createElement("div");
            element.className = "bpm-slot";
            if (!item) {
                element.setAttribute("aria-label", `${slotName}: empty`);
                return element;
            }

            const icon = document.createElement("span");
            icon.className = "bpm-item-icon";
            icon.style.setProperty("--bpm-item-color", `#${itemColor(item).getHexString()}`);
            icon.textContent = initials(item.id);
            const count = document.createElement("span");
            count.className = "bpm-item-count";
            count.textContent = item.count > 1 ? item.count : "";
            element.append(icon, count);

            const durability = item.maxDamage
                ? `\nDurability: ${item.maxDamage - item.damage}/${item.maxDamage}`
                : "";
            element.title = `${item.name} ×${item.count}\n${item.id}${durability}`;
            element.setAttribute("aria-label", `${slotName}: ${item.name}, ${item.count}`);
            element.classList.toggle("bpm-glint", item.glint);
            return element;
        }

        function statusDot(online) {
            const dot = document.createElement("span");
            dot.className = `bpm-status-dot ${online ? "bpm-online" : "bpm-offline"}`;
            dot.setAttribute("aria-hidden", "true");
            return dot;
        }

        const initials = id => id.split(":").pop().split("_")
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
        setInterval(() => {
            resetForMap();
            refresh();
        }, 1000);
        resetForMap();
        refresh();
    };

    function createUi() {
        const ui = document.createElement("div");
        ui.id = "bpm-ui";
        ui.innerHTML = `
            <section id="bpm-player-card" aria-live="polite" hidden>
                <button id="bpm-deselect" type="button" aria-label="Deselect player">×</button>
                <div class="bpm-card-heading">
                    <strong id="bpm-player-name"></strong>
                    <span id="bpm-player-status"></span>
                </div>
                <dl>
                    <div><dt>Position</dt><dd id="bpm-player-position"></dd></div>
                    <div><dt>Held item</dt><dd id="bpm-player-held"></dd></div>
                </dl>
                <button id="bpm-open-inventory" class="bpm-primary" type="button">View inventory</button>
            </section>
            <dialog id="bpm-inventory" aria-labelledby="bpm-inventory-title">
                <form method="dialog">
                    <div class="bpm-dialog-heading">
                        <div>
                            <h2 id="bpm-inventory-title"></h2>
                            <p id="bpm-inventory-meta"></p>
                        </div>
                        <button type="submit" aria-label="Close inventory">×</button>
                    </div>
                    <h3>Equipment</h3>
                    <div id="bpm-equipment-grid" class="bpm-equipment-grid"></div>
                    <h3>Inventory</h3>
                    <div id="bpm-inventory-grid" class="bpm-inventory-grid"></div>
                </form>
            </dialog>
        `;
        return ui;
    }

    start();
})();

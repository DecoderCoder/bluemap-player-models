package de.decode.bluemapplayermodels;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.properties.Property;
import com.mojang.logging.LogUtils;
import de.bluecolored.bluemap.api.AssetStorage;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.item.DyeableLeatherItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.registries.ForgeRegistries;
import org.slf4j.Logger;

import javax.imageio.ImageIO;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

final class BlueMapPlayerModelsServer {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final String ASSET_ROOT = "bluemap-player-models";
    private static final String PLAYER_DATA_ASSET = ASSET_ROOT + "/players.json";
    private static final String WEB_ASSET_VERSION = "1.1.0";
    private static final String MINECRAFT_CLIENT = "minecraft-client-1.20.1.jar";
    private static final int ENTITY_LIMIT = 128;
    private static final long SKIN_RETRY_DELAY_MS = 60_000;
    private static final long SKIN_REFRESH_MS = 24 * 60 * 60 * 1_000L;
    private static final Pattern DATA_PATH = Pattern.compile(
        "^\\s*data\\s*:\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s#]+))\\s*(?:#.*)?$"
    );
    private static final List<String> TEXTURE_PREFIXES = List.of(
        "assets/minecraft/textures/entity/",
        "assets/minecraft/textures/models/armor/",
        "assets/minecraft/textures/item/",
        "assets/minecraft/textures/block/"
    );

    private final Map<UUID, PlayerData> players = new ConcurrentHashMap<>();
    private final AtomicBoolean publishing = new AtomicBoolean();
    private final Set<UUID> requestedSkins = ConcurrentHashMap.newKeySet();
    private final Map<UUID, Long> skinRetryAt = new ConcurrentHashMap<>();
    private final ExecutorService skinExecutor = daemonExecutor("bluemap-player-models-skin", 2);
    private final ExecutorService publicationExecutor = daemonExecutor("bluemap-player-models-publish", 1);

    private volatile BlueMapAPI blueMap;
    private volatile Map<String, List<EntityData>> entitiesByWorld = Map.of();
    private volatile Path skinRoot;
    private MinecraftServer server;
    private Path stateFile;
    private int ticks;

    BlueMapPlayerModelsServer() {
        MinecraftForge.EVENT_BUS.register(this);
        BlueMapAPI.onEnable(this::enableBlueMap);
        BlueMapAPI.onDisable(api -> {
            if (blueMap == api) {
                blueMap = null;
                entitiesByWorld = Map.of();
                skinRoot = null;
            }
        });
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        server = event.getServer();
        stateFile = server.getWorldPath(LevelResource.ROOT)
            .resolve("data")
            .resolve(ASSET_ROOT + ".json");
        loadState();
        updateOnlinePlayers();
        updateEntities();
        publish();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        event.getServer().getPlayerList().getPlayers().forEach(player -> snapshot(player, false));
        saveState();
        entitiesByWorld = Map.of();
        server = null;
        skinExecutor.shutdownNow();
        publicationExecutor.shutdown();
    }

    @SubscribeEvent
    public void onPlayerLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            snapshot(player, true);
        }
    }

    @SubscribeEvent
    public void onPlayerLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            snapshot(player, false);
            saveState();
            publish();
        }
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null || ++ticks % 20 != 0) {
            return;
        }

        updateOnlinePlayers();
        updateEntities();
        publish();
    }

    private void enableBlueMap(BlueMapAPI api) {
        try {
            Path root = api.getWebApp().getWebRoot();
            String script = "player-models-" + WEB_ASSET_VERSION + ".js";
            String style = "player-models-" + WEB_ASSET_VERSION + ".css";
            copyResource("/web/player-models.js", root.resolve(ASSET_ROOT).resolve(script));
            copyResource("/web/player-models.css", root.resolve(ASSET_ROOT).resolve(style));
            exportMinecraftTextures(root.resolve(ASSET_ROOT).resolve("minecraft"));
            api.getWebApp().registerScript(ASSET_ROOT + "/" + script);
            api.getWebApp().registerStyle(ASSET_ROOT + "/" + style);
            skinRoot = Files.createDirectories(root.resolve(ASSET_ROOT).resolve("skins"));
            requestedSkins.clear();
            skinRetryAt.clear();
            blueMap = api;
            publish();
            LOGGER.info("BlueMap Player Models {} web assets installed", WEB_ASSET_VERSION);
        } catch (IOException exception) {
            LOGGER.error("Failed to install BlueMap Player Models web assets", exception);
        }
    }

    private static void copyResource(String resource, Path target) throws IOException {
        Files.createDirectories(target.getParent());
        try (InputStream input = BlueMapPlayerModelsServer.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IOException("Missing bundled resource " + resource);
            }
            Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void updateOnlinePlayers() {
        if (server != null) {
            server.getPlayerList().getPlayers().forEach(player -> snapshot(player, true));
        }
    }

    private void updateEntities() {
        MinecraftServer currentServer = server;
        BlueMapAPI api = blueMap;
        if (currentServer == null || api == null) {
            entitiesByWorld = Map.of();
            return;
        }

        Set<String> mappedWorlds = api.getMaps().stream()
            .map(map -> map.getWorld().getId())
            .collect(java.util.stream.Collectors.toSet());
        Map<String, List<EntityData>> snapshot = new HashMap<>();
        for (ServerLevel level : currentServer.getAllLevels()) {
            String worldId = api.getWorld(level)
                .map(world -> world.getId())
                .orElse(null);
            if (worldId == null || !mappedWorlds.contains(worldId)) {
                continue;
            }

            List<EntityData> entities = new ArrayList<>();
            for (Entity entity : level.getAllEntities()) {
                if (entities.size() >= ENTITY_LIMIT) {
                    break;
                }
                if (entity instanceof ServerPlayer || entity.isRemoved() || !entity.isAlive()) {
                    continue;
                }

                EntityData data = entity(entity);
                if (data != null) {
                    entities.add(data);
                }
            }
            snapshot.put(worldId, List.copyOf(entities));
        }
        entitiesByWorld = Map.copyOf(snapshot);
    }

    private static EntityData entity(Entity entity) {
        var type = ForgeRegistries.ENTITY_TYPES.getKey(entity.getType());
        if (type == null) {
            return null;
        }

        EntityData data = new EntityData();
        data.uuid = entity.getStringUUID();
        data.type = type.toString();
        data.name = entity.getDisplayName().getString();
        data.customName = entity.hasCustomName() && entity.getCustomName() != null
            ? entity.getCustomName().getString()
            : null;
        data.x = entity.getX();
        data.y = entity.getY();
        data.z = entity.getZ();
        data.yaw = entity.getYRot();
        data.pitch = entity.getXRot();
        data.width = entity.getBbWidth();
        data.height = entity.getBbHeight();
        return data;
    }

    private void snapshot(ServerPlayer player, boolean online) {
        PlayerData previous = players.get(player.getUUID());
        PlayerData data = new PlayerData();
        data.uuid = player.getStringUUID();
        data.name = player.getGameProfile().getName();
        data.online = online;
        data.moving = online && player.getDeltaMovement().horizontalDistanceSqr() > 0.0004;
        data.crouching = player.isCrouching();
        data.leftHanded = player.getMainArm() == HumanoidArm.LEFT;
        data.x = player.getX();
        data.y = player.getY();
        data.z = player.getZ();
        data.yaw = player.getYHeadRot();
        data.pitch = player.getXRot();
        data.lastSeen = System.currentTimeMillis();
        data.selectedSlot = player.getInventory().selected;
        data.worldId = worldId(player, previous);

        data.slim = hasSlimSkin(player);
        data.skin = ASSET_ROOT + "/skins/" + data.uuid + ".png";
        cacheSkin(player.getUUID());

        data.mainHand = item(player.getMainHandItem());
        data.offHand = item(player.getOffhandItem());
        data.armor = Arrays.asList(
            item(player.getItemBySlot(EquipmentSlot.HEAD)),
            item(player.getItemBySlot(EquipmentSlot.CHEST)),
            item(player.getItemBySlot(EquipmentSlot.LEGS)),
            item(player.getItemBySlot(EquipmentSlot.FEET))
        );
        data.inventory = new ArrayList<>(player.getInventory().items.size());
        player.getInventory().items.forEach(stack -> data.inventory.add(item(stack)));
        players.put(player.getUUID(), data);
    }

    private String worldId(ServerPlayer player, PlayerData previous) {
        BlueMapAPI api = blueMap;
        if (api != null) {
            return api.getWorld(player.serverLevel())
                .map(world -> world.getId())
                .orElse(previous == null ? null : previous.worldId);
        }
        return previous == null ? null : previous.worldId;
    }

    private static ItemData item(ItemStack stack) {
        if (stack.isEmpty()) {
            return null;
        }

        ItemData item = new ItemData();
        item.id = String.valueOf(ForgeRegistries.ITEMS.getKey(stack.getItem()));
        item.name = stack.getHoverName().getString();
        item.count = stack.getCount();
        item.damage = stack.getDamageValue();
        item.maxDamage = stack.getMaxDamage();
        item.glint = stack.hasFoil();
        if (stack.getItem() instanceof DyeableLeatherItem dyeable) {
            item.color = String.format("#%06x", dyeable.getColor(stack));
        }
        return item;
    }

    private static boolean hasSlimSkin(ServerPlayer player) {
        Property property = player.getGameProfile().getProperties().get("textures").stream()
            .findFirst()
            .orElse(null);
        if (property == null) {
            return false;
        }

        try {
            String json = new String(Base64.getDecoder().decode(property.getValue()), StandardCharsets.UTF_8);
            JsonObject skin = JsonParser.parseString(json).getAsJsonObject()
                .getAsJsonObject("textures")
                .getAsJsonObject("SKIN");
            return skin.has("metadata")
                && "slim".equals(skin.getAsJsonObject("metadata").get("model").getAsString());
        } catch (RuntimeException exception) {
            LOGGER.debug("Invalid skin metadata for {}", player.getGameProfile().getName(), exception);
            return false;
        }
    }

    private void cacheSkin(UUID uuid) {
        Path root = skinRoot;
        BlueMapAPI api = blueMap;
        if (root == null || api == null) {
            return;
        }

        Path target = root.resolve(uuid + ".png");
        long now = System.currentTimeMillis();
        if (isFreshSkin(target, now)
            || skinRetryAt.getOrDefault(uuid, 0L) > now
            || !requestedSkins.add(uuid)) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
            try {
                var skin = api.getPlugin().getSkinProvider().load(uuid);
                if (skin.isEmpty()) {
                    skinRetryAt.put(uuid, System.currentTimeMillis() + SKIN_RETRY_DELAY_MS);
                    return;
                }
                Files.createDirectories(target.getParent());
                if (!ImageIO.write(skin.get(), "png", temporary.toFile())) {
                    throw new IOException("No PNG image writer is available");
                }
                replaceAtomically(temporary, target);
                skinRetryAt.remove(uuid);
            } catch (IOException | RuntimeException exception) {
                skinRetryAt.put(uuid, System.currentTimeMillis() + SKIN_RETRY_DELAY_MS);
                LOGGER.warn("Failed to cache skin for {}", uuid, exception);
            } finally {
                requestedSkins.remove(uuid);
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException exception) {
                    LOGGER.debug("Failed to remove temporary skin {}", temporary, exception);
                }
            }
        }, skinExecutor);
    }

    private static boolean isFreshSkin(Path target, long now) {
        try {
            return Files.isRegularFile(target)
                && Files.size(target) > 0
                && Files.getLastModifiedTime(target).toMillis() > now - SKIN_REFRESH_MS;
        } catch (IOException exception) {
            return false;
        }
    }

    private static void exportMinecraftTextures(Path targetRoot) {
        Path minecraftClient = findMinecraftClient();
        if (minecraftClient == null) {
            LOGGER.warn(
                "Could not find {}; entity and item textures will use browser fallbacks",
                MINECRAFT_CLIENT
            );
            return;
        }

        Path safeRoot = targetRoot.toAbsolutePath().normalize();
        int copied = 0;
        try (ZipFile client = new ZipFile(minecraftClient.toFile())) {
            var entries = client.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (entry.isDirectory()
                    || !name.endsWith(".png")
                    || TEXTURE_PREFIXES.stream().noneMatch(name::startsWith)) {
                    continue;
                }

                Path target = safeRoot.resolve(name).normalize();
                if (!target.startsWith(safeRoot)) {
                    LOGGER.warn("Skipped unsafe path in {}: {}", minecraftClient, name);
                    continue;
                }
                if (Files.isRegularFile(target)
                    && entry.getSize() >= 0
                    && Files.size(target) == entry.getSize()) {
                    continue;
                }

                Files.createDirectories(target.getParent());
                try (InputStream input = client.getInputStream(entry)) {
                    Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
                }
                copied++;
            }
            LOGGER.info(
                "Exported {} vanilla texture(s) from {} to {}",
                copied,
                minecraftClient,
                safeRoot
            );
        } catch (IOException exception) {
            LOGGER.warn("Failed to export vanilla textures from {}", minecraftClient, exception);
        }
    }

    private static Path findMinecraftClient() {
        Path serverRoot = Path.of("").toAbsolutePath().normalize();
        Path configuredData = configuredBlueMapData(serverRoot);
        if (configuredData != null) {
            Path configuredClient = configuredData.resolve(MINECRAFT_CLIENT);
            if (Files.isRegularFile(configuredClient)) {
                return configuredClient;
            }
        }

        Path defaultClient = serverRoot.resolve("bluemap").resolve(MINECRAFT_CLIENT);
        return Files.isRegularFile(defaultClient) ? defaultClient : null;
    }

    private static Path configuredBlueMapData(Path serverRoot) {
        Path coreConfig = serverRoot.resolve("config").resolve("bluemap").resolve("core.conf");
        if (!Files.isRegularFile(coreConfig)) {
            return null;
        }

        try {
            for (String line : Files.readAllLines(coreConfig, StandardCharsets.UTF_8)) {
                Matcher matcher = DATA_PATH.matcher(line);
                if (!matcher.matches()) {
                    continue;
                }

                String value = matcher.group(1) != null
                    ? matcher.group(1)
                    : matcher.group(2) != null ? matcher.group(2) : matcher.group(3);
                if (value == null || value.contains("${")) {
                    return null;
                }
                Path configured = Path.of(value.replace("\\\\", "\\"));
                return (configured.isAbsolute() ? configured : serverRoot.resolve(configured))
                    .toAbsolutePath()
                    .normalize();
            }
        } catch (IOException | RuntimeException exception) {
            LOGGER.debug("Could not read BlueMap data path from {}", coreConfig, exception);
        }
        return null;
    }

    private void publish() {
        BlueMapAPI api = blueMap;
        if (api == null || !publishing.compareAndSet(false, true)) {
            return;
        }

        List<Publication> publications = new ArrayList<>();
        for (BlueMapMap map : api.getMaps()) {
            List<PlayerData> visible = players.values().stream()
                .filter(player -> map.getWorld().getId().equals(player.worldId))
                .filter(player -> api.getWebApp().getPlayerVisibility(UUID.fromString(player.uuid)))
                .toList();
            List<EntityData> entities = entitiesByWorld.getOrDefault(map.getWorld().getId(), List.of());
            byte[] json = GSON.toJson(new Payload(System.currentTimeMillis(), visible, entities))
                .getBytes(StandardCharsets.UTF_8);
            publications.add(new Publication(map.getAssetStorage(), json));
        }

        CompletableFuture.runAsync(() -> {
            for (Publication publication : publications) {
                try (OutputStream output = publication.storage.writeAsset(PLAYER_DATA_ASSET)) {
                    output.write(publication.json);
                } catch (IOException exception) {
                    LOGGER.warn("Failed to publish player models to BlueMap", exception);
                }
            }
        }, publicationExecutor).whenComplete((ignored, error) -> {
            publishing.set(false);
            if (error != null) {
                LOGGER.warn("Failed to publish player models to BlueMap", error);
            }
        });
    }

    private void loadState() {
        players.clear();
        if (stateFile == null || !Files.isRegularFile(stateFile)) {
            // ponytail: only players seen after installation are tracked; import playerdata NBT if historical coverage is needed.
            return;
        }

        try {
            State state = GSON.fromJson(Files.readString(stateFile), State.class);
            if (state == null || state.players == null) {
                return;
            }
            for (PlayerData player : state.players) {
                if (player == null || player.uuid == null || player.worldId == null) {
                    continue;
                }
                player.online = false;
                players.put(UUID.fromString(player.uuid), player);
            }
        } catch (IOException | RuntimeException exception) {
            LOGGER.error("Failed to read {}", stateFile, exception);
        }
    }

    private void saveState() {
        if (stateFile == null) {
            return;
        }

        try {
            Files.createDirectories(stateFile.getParent());
            Path temporary = stateFile.resolveSibling(stateFile.getFileName() + ".tmp");
            Files.writeString(temporary, GSON.toJson(new State(new ArrayList<>(players.values()))));
            replaceAtomically(temporary, stateFile);
        } catch (IOException exception) {
            LOGGER.error("Failed to save {}", stateFile, exception);
        }
    }

    private static void replaceAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static ExecutorService daemonExecutor(String name, int threads) {
        AtomicInteger counter = new AtomicInteger();
        return Executors.newFixedThreadPool(threads, task -> {
            Thread thread = new Thread(task, name + "-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
    }

    private record Publication(AssetStorage storage, byte[] json) {}

    private record Payload(long updatedAt, List<PlayerData> players, List<EntityData> entities) {}

    private record State(List<PlayerData> players) {}

    private static final class PlayerData {
        String uuid;
        String name;
        String worldId;
        String skin;
        boolean slim;
        boolean online;
        boolean moving;
        boolean crouching;
        boolean leftHanded;
        double x;
        double y;
        double z;
        float yaw;
        float pitch;
        long lastSeen;
        int selectedSlot;
        ItemData mainHand;
        ItemData offHand;
        List<ItemData> armor;
        List<ItemData> inventory;
    }

    private static final class ItemData {
        String id;
        String name;
        String color;
        int count;
        int damage;
        int maxDamage;
        boolean glint;
    }

    private static final class EntityData {
        String uuid;
        String type;
        String name;
        String customName;
        double x;
        double y;
        double z;
        float yaw;
        float pitch;
        float width;
        float height;
    }
}

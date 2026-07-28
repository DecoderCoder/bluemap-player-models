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
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.FilePackResources;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.PathPackResources;
import net.minecraft.server.packs.metadata.pack.PackMetadataSection;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.DyeableLeatherItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.world.item.alchemy.PotionUtils;
import net.minecraft.world.item.armortrim.ArmorTrim;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.fml.loading.FMLPaths;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.resource.DelegatingPackResources;
import net.minecraftforge.resource.ResourcePackLoader;
import org.slf4j.Logger;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class BlueMapPlayerModelsServer {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    private static final String ASSET_ROOT = "bluemap-player-models";
    private static final String PLAYER_DATA_ASSET = ASSET_ROOT + "/players.json";
    private static final String SKIN_ASSET_ROOT = ASSET_ROOT + "/skins";
    private static final String WEB_ASSET_VERSION = "1.2.3";
    private static final String MINECRAFT_CLIENT = "minecraft-client-1.20.1.jar";
    private static final int RESOURCE_MANIFEST_FORMAT = 1;
    private static final int MAX_SKIN_BYTES = 2_000_000;
    private static final int ENTITY_LIMIT = 128;
    private static final long SKIN_RETRY_DELAY_MS = 60_000;
    private static final long SKIN_REFRESH_MS = 24 * 60 * 60 * 1_000L;
    private static final Pattern DATA_PATH = Pattern.compile(
        "^\\s*data\\s*:\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s#]+))\\s*(?:#.*)?$"
    );

    private final Map<UUID, PlayerData> players = new ConcurrentHashMap<>();
    private final AtomicBoolean publishing = new AtomicBoolean();
    private final Set<UUID> requestedSkins = ConcurrentHashMap.newKeySet();
    private final Set<String> publishedSkins = ConcurrentHashMap.newKeySet();
    private final Map<UUID, String> skinAssets = new ConcurrentHashMap<>();
    private final Map<UUID, URI> skinSources = new ConcurrentHashMap<>();
    private final Map<UUID, Long> skinRetryAt = new ConcurrentHashMap<>();
    private final ExecutorService skinExecutor = daemonExecutor("bluemap-player-models-skin", 2);
    private final ExecutorService publicationExecutor = daemonExecutor("bluemap-player-models-publish", 1);

    private volatile BlueMapAPI blueMap;
    private volatile long apiGeneration;
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
                apiGeneration++;
                blueMap = null;
                entitiesByWorld = Map.of();
                skinRoot = null;
                publishedSkins.clear();
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
            publishClientResources(root.resolve(ASSET_ROOT));
            api.getWebApp().registerScript(ASSET_ROOT + "/" + script);
            api.getWebApp().registerStyle(ASSET_ROOT + "/" + style);
            skinRoot = Files.createDirectories(root.resolve(ASSET_ROOT).resolve("skins"));
            apiGeneration++;
            publishedSkins.clear();
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
        data.name = player.getDisplayName().getString();
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

        SkinInfo skin = skinInfo(player);
        data.slim = skin.slim();
        data.skin = skinAssets.get(player.getUUID());
        data.skinUrl = skin.uri() == null
            ? previous == null ? null : previous.skinUrl
            : skin.uri().toString();

        boolean usingMainHand = player.isUsingItem()
            && player.getUsedItemHand() == InteractionHand.MAIN_HAND;
        boolean usingOffHand = player.isUsingItem()
            && player.getUsedItemHand() == InteractionHand.OFF_HAND;
        data.mainHand = item(player.getMainHandItem(), player, usingMainHand, true);
        data.offHand = item(player.getOffhandItem(), player, usingOffHand, true);
        data.armor = Arrays.asList(
            item(player.getItemBySlot(EquipmentSlot.HEAD), player, false, false),
            item(player.getItemBySlot(EquipmentSlot.CHEST), player, false, false),
            item(player.getItemBySlot(EquipmentSlot.LEGS), player, false, false),
            item(player.getItemBySlot(EquipmentSlot.FEET), player, false, false)
        );
        data.inventory = new ArrayList<>(player.getInventory().items.size());
        for (int index = 0; index < player.getInventory().items.size(); index++) {
            data.inventory.add(item(
                player.getInventory().items.get(index),
                player,
                usingMainHand && index == data.selectedSlot,
                index == data.selectedSlot
            ));
        }
        players.put(player.getUUID(), data);
        cacheSkin(player.getUUID(), skin.uri());
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

    private static ItemData item(
        ItemStack stack,
        ServerPlayer user,
        boolean active,
        boolean held
    ) {
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
        item.active = active;
        item.leftHanded = user != null && user.getMainArm() == HumanoidArm.LEFT;
        item.cast = user != null
            && held
            && user.fishing != null
            && stack.is(Items.FISHING_ROD);
        item.charged = stack.getItem() instanceof CrossbowItem && CrossbowItem.isCharged(stack);
        item.firework = stack.getItem() instanceof CrossbowItem
            && CrossbowItem.containsChargedProjectile(stack, Items.FIREWORK_ROCKET);
        item.filled = stack.is(Items.BUNDLE)
            && stack.hasTag()
            && !stack.getTag().getList("Items", Tag.TAG_COMPOUND).isEmpty();
        if (stack.is(Items.LIGHT) && stack.hasTag()) {
            CompoundTag blockState = stack.getTag().getCompound("BlockStateTag");
            try {
                item.level = Math.max(0, Math.min(15, Integer.parseInt(blockState.getString("level"))))
                    / 15.0F;
            } catch (NumberFormatException ignored) {
                item.level = 0;
            }
        }
        if (active) {
            int usedTicks = Math.max(
                0,
                stack.getUseDuration() - user.getUseItemRemainingTicks()
            );
            item.useProgress = stack.getItem() instanceof CrossbowItem
                ? usedTicks / (float) Math.max(1, CrossbowItem.getChargeDuration(stack))
                : usedTicks / 20.0F;
        }
        if (stack.hasTag()
            && stack.getTag().contains("CustomModelData", Tag.TAG_ANY_NUMERIC)) {
            item.customModelData = stack.getTag().getInt("CustomModelData");
        }
        if (stack.getItem() instanceof DyeableLeatherItem dyeable) {
            item.color = String.format("#%06x", dyeable.getColor(stack));
        }
        if (stack.getItem() instanceof ArmorItem armor) {
            item.armorTexture = armorTexture(armor, false);
            if (stack.getItem() instanceof DyeableLeatherItem) {
                item.armorOverlayTexture = armorTexture(armor, true);
            }
        }
        if (user != null) {
            ArmorTrim.getTrim(user.level().registryAccess(), stack).ifPresent(trim -> {
                item.trimType = trim.material().value().itemModelIndex();
                if (stack.getItem() instanceof ArmorItem armor) {
                    item.trimTexture = (armor.getType() == ArmorItem.Type.LEGGINGS
                        ? trim.innerTexture(armor.getMaterial())
                        : trim.outerTexture(armor.getMaterial())).toString();
                }
            });
        }
        if (stack.getItem() instanceof SpawnEggItem egg) {
            item.tints = List.of(
                String.format("#%06x", egg.getColor(0)),
                String.format("#%06x", egg.getColor(1))
            );
        } else if (stack.is(Items.POTION)
            || stack.is(Items.SPLASH_POTION)
            || stack.is(Items.LINGERING_POTION)
            || stack.is(Items.TIPPED_ARROW)) {
            item.tints = List.of(String.format("#%06x", PotionUtils.getColor(stack)));
        }
        return item;
    }

    private static String armorTexture(ArmorItem armor, boolean overlay) {
        ResourceLocation material = ResourceLocation.tryParse(armor.getMaterial().getName());
        if (material == null) {
            return null;
        }
        int layer = armor.getType() == ArmorItem.Type.LEGGINGS ? 2 : 1;
        return material.getNamespace() + ":models/armor/" + material.getPath()
            + "_layer_" + layer + (overlay ? "_overlay" : "");
    }

    private static SkinInfo skinInfo(ServerPlayer player) {
        Property property = player.getGameProfile().getProperties().get("textures").stream()
            .findFirst()
            .orElse(null);
        if (property == null) {
            return SkinInfo.EMPTY;
        }

        try {
            String json = new String(Base64.getDecoder().decode(property.getValue()), StandardCharsets.UTF_8);
            JsonObject skin = JsonParser.parseString(json).getAsJsonObject()
                .getAsJsonObject("textures")
                .getAsJsonObject("SKIN");
            URI uri = validatedSkinUri(skin.get("url").getAsString());
            boolean slim = skin.has("metadata")
                && "slim".equals(skin.getAsJsonObject("metadata").get("model").getAsString());
            return new SkinInfo(uri, slim);
        } catch (RuntimeException exception) {
            LOGGER.debug("Invalid skin metadata for {}", player.getGameProfile().getName(), exception);
            return SkinInfo.EMPTY;
        }
    }

    private static URI validatedSkinUri(String value) {
        URI uri = URI.create(value);
        String path = uri.getRawPath();
        if (!"textures.minecraft.net".equalsIgnoreCase(uri.getHost())
            || (!"http".equalsIgnoreCase(uri.getScheme())
                && !"https".equalsIgnoreCase(uri.getScheme()))
            || path == null
            || !path.matches("/texture/[0-9a-fA-F]+")) {
            throw new IllegalArgumentException("Unexpected Minecraft skin URL");
        }
        return URI.create("https://textures.minecraft.net" + path);
    }

    private void cacheSkin(UUID uuid, URI uri) {
        Path root = skinRoot;
        BlueMapAPI api = blueMap;
        long generation = apiGeneration;
        if (root == null || api == null) {
            return;
        }

        Path target = root.resolve(uuid + ".png");
        long now = System.currentTimeMillis();
        boolean sourceChanged = uri != null && !uri.equals(skinSources.get(uuid));
        boolean fresh = !sourceChanged && isFreshSkin(target, now);
        String knownAsset = skinAssets.get(uuid);
        if ((fresh && knownAsset != null && isSkinPublished(api, knownAsset))
            || skinRetryAt.getOrDefault(uuid, 0L) > now
            || !requestedSkins.add(uuid)) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
            try {
                if (!isActiveApi(api, generation)) {
                    return;
                }
                boolean published = true;
                if (Files.isRegularFile(target) && Files.size(target) > 0) {
                    String cachedAsset = skinAssetName(uuid, target);
                    published = publishSkin(api, generation, target, cachedAsset);
                    activateSkin(api, generation, uuid, cachedAsset);
                }
                if (!fresh) {
                    BufferedImage skin = loadSkin(api, uuid, uri);
                    if (skin == null) {
                        skinRetryAt.put(uuid, System.currentTimeMillis() + SKIN_RETRY_DELAY_MS);
                        return;
                    }
                    if (!isActiveApi(api, generation)) {
                        return;
                    }
                    Files.createDirectories(target.getParent());
                    if (!ImageIO.write(skin, "png", temporary.toFile())) {
                        throw new IOException("No PNG image writer is available");
                    }
                    replaceAtomically(temporary, target);
                    if (uri != null) {
                        skinSources.put(uuid, uri);
                    }
                    String asset = skinAssetName(uuid, target);
                    published = publishSkin(api, generation, target, asset);
                    activateSkin(api, generation, uuid, asset);
                }
                if (published) {
                    skinRetryAt.remove(uuid);
                } else {
                    skinRetryAt.put(uuid, System.currentTimeMillis() + SKIN_RETRY_DELAY_MS);
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                skinRetryAt.put(uuid, System.currentTimeMillis() + SKIN_RETRY_DELAY_MS);
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

    private boolean isActiveApi(BlueMapAPI api, long generation) {
        return blueMap == api && apiGeneration == generation;
    }

    private void activateSkin(BlueMapAPI api, long generation, UUID uuid, String asset) {
        if (!isActiveApi(api, generation)) {
            return;
        }
        skinAssets.put(uuid, asset);
        PlayerData player = players.get(uuid);
        if (player != null) {
            player.skin = asset;
        }
        publish();
    }

    private static BufferedImage loadSkin(BlueMapAPI api, UUID uuid, URI uri)
        throws IOException, InterruptedException {
        if (uri != null) {
            try {
                HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(15))
                    .GET()
                    .build();
                HttpResponse<InputStream> response = HTTP.send(
                    request,
                    HttpResponse.BodyHandlers.ofInputStream()
                );
                try (InputStream input = response.body()) {
                    byte[] body = input.readNBytes(MAX_SKIN_BYTES + 1);
                    if (response.statusCode() == 200 && body.length <= MAX_SKIN_BYTES) {
                        BufferedImage image = ImageIO.read(new ByteArrayInputStream(body));
                        if (isMinecraftSkin(image)) {
                            return image;
                        }
                    }
                }
                LOGGER.debug("Invalid skin response for {}: HTTP {}", uuid, response.statusCode());
            } catch (IOException exception) {
                LOGGER.debug("Direct skin download failed for {}; trying BlueMap's provider", uuid, exception);
            }
        }

        BufferedImage image = api.getPlugin().getSkinProvider().load(uuid).orElse(null);
        return isMinecraftSkin(image) ? image : null;
    }

    private static boolean isMinecraftSkin(BufferedImage image) {
        return image != null
            && image.getWidth() == 64
            && (image.getHeight() == 32 || image.getHeight() == 64);
    }

    private boolean isSkinPublished(BlueMapAPI api, String asset) {
        return api.getMaps().stream()
            .allMatch(map -> isSkinPublished(map, asset));
    }

    private boolean isSkinPublished(BlueMapMap map, String asset) {
        return asset != null && publishedSkins.contains(map.getId() + ":" + asset);
    }

    private boolean publishSkin(BlueMapAPI api, long generation, Path source, String asset) {
        boolean complete = true;
        for (BlueMapMap map : api.getMaps()) {
            if (!isActiveApi(api, generation)) {
                return false;
            }
            String key = map.getId() + ":" + asset;
            if (publishedSkins.contains(key)) {
                continue;
            }
            try (InputStream input = Files.newInputStream(source);
                 OutputStream output = map.getAssetStorage().writeAsset(asset)) {
                input.transferTo(output);
            } catch (IOException exception) {
                publishedSkins.remove(key);
                complete = false;
                LOGGER.warn("Failed to publish skin {} to BlueMap map {}", asset, map.getId(), exception);
                continue;
            }
            if (!isActiveApi(api, generation)) {
                return false;
            }
            publishedSkins.add(key);
        }
        return complete;
    }

    private static String skinAssetName(UUID uuid, Path source) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source));
            String hash = HexFormat.of().formatHex(digest, 0, 8);
            // ponytail: superseded fingerprinted skins stay cached; prune if storage growth becomes measurable.
            return SKIN_ASSET_ROOT + "/" + uuid + "-" + hash + ".png";
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256 is unavailable", exception);
        }
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

    private static void publishClientResources(Path targetRoot) {
        try {
            List<PackResources> packs = clientResourcePacks();
            if (packs.isEmpty()) {
                LOGGER.warn("No client resource packs were available; keeping the previous resource manifest");
                return;
            }

            Path safeRoot = Files.createDirectories(targetRoot).toAbsolutePath().normalize();
            Path objectsRoot = Files.createDirectories(resolveInside(safeRoot, "resources/objects"));
            Map<String, String> models = new TreeMap<>();
            Map<String, String> textures = new TreeMap<>();
            Map<String, String> metadata = new TreeMap<>();
            Map<String, String> atlases = new TreeMap<>();

            try (MultiPackResourceManager resources =
                     new MultiPackResourceManager(PackType.CLIENT_RESOURCES, packs)) {
                Map<ResourceLocation, Resource> textureResources = resources.listResources(
                    "textures",
                    id -> id.getPath().endsWith(".png")
                );
                Map<ResourceLocation, Resource> atlasResources = resources.listResources(
                    "atlases",
                    id -> id.getPath().endsWith(".json")
                );
                publishResources(
                    resources.listResources("models", id -> id.getPath().endsWith(".json")),
                    "models/",
                    ".json",
                    "json",
                    objectsRoot,
                    models
                );
                publishResources(
                    textureResources,
                    "textures/",
                    ".png",
                    "png",
                    objectsRoot,
                    textures
                );
                publishTextureMetadata(
                    resources,
                    textureResources,
                    objectsRoot,
                    metadata
                );
                publishResources(
                    atlasResources,
                    "atlases/",
                    ".json",
                    "json",
                    objectsRoot,
                    atlases
                );
                publishAtlasTextures(
                    resources,
                    atlasResources,
                    textureResources,
                    objectsRoot,
                    textures,
                    metadata
                );
            }

            String generation = resourceGeneration(models, textures, metadata, atlases);
            writeResourceManifest(
                safeRoot,
                new ResourceManifest(
                    RESOURCE_MANIFEST_FORMAT,
                    generation,
                    models,
                    textures,
                    metadata,
                    atlases
                )
            );
            // ponytail: immutable orphan objects stay cached; prune if web-root growth becomes measurable.
            LOGGER.info(
                "Published client-resource manifest {} with {} model(s), {} texture(s), "
                    + "{} metadata file(s), and {} atlas file(s)",
                generation,
                models.size(),
                textures.size(),
                metadata.size(),
                atlases.size()
            );
        } catch (IOException | RuntimeException exception) {
            LOGGER.warn("Failed to publish client resources; keeping the previous manifest", exception);
        }
    }

    private static void publishTextureMetadata(
        MultiPackResourceManager resources,
        Map<ResourceLocation, Resource> textures,
        Path objectsRoot,
        Map<String, String> manifestEntries
    ) throws IOException {
        Map<String, Integer> packPriorities = new HashMap<>();
        List<PackResources> packs = resources.listPacks().toList();
        for (int index = 0; index < packs.size(); index++) {
            packPriorities.put(packs.get(index).packId(), index);
        }

        for (var entry : new TreeMap<>(textures).entrySet()) {
            ResourceLocation id = entry.getKey();
            int texturePriority = packPriorities.getOrDefault(entry.getValue().sourcePackId(), 0);
            Resource metadata = null;
            for (Resource candidate : resources.getResourceStack(id.withSuffix(".mcmeta"))) {
                if (packPriorities.getOrDefault(candidate.sourcePackId(), 0) >= texturePriority) {
                    metadata = candidate;
                }
            }
            if (metadata == null) {
                continue;
            }

            String path = id.getPath();
            String key = id.getNamespace() + ":"
                + path.substring("textures/".length(), path.length() - ".png".length());
            manifestEntries.put(key, publishResourceObject(objectsRoot, metadata, "mcmeta"));
        }
    }

    private static List<PackResources> clientResourcePacks() throws IOException {
        List<PackResources> packs = new ArrayList<>();
        Path minecraftClient = findMinecraftClient();
        if (minecraftClient == null) {
            LOGGER.warn("Could not find {}; keeping the previous resource manifest", MINECRAFT_CLIENT);
            return packs;
        }
        packs.add(new FilePackResources("bpm-vanilla", minecraftClient.toFile(), true));

        List<PackResources> modPacks = ModList.get().getModFiles().stream()
            .filter(file -> file.requiredLanguageLoaders().stream()
                .noneMatch(loader -> "minecraft".equals(loader.languageName())))
            .map(ResourcePackLoader::createPackForMod)
            .map(PackResources.class::cast)
            .toList();
        if (!modPacks.isEmpty()) {
            packs.add(new DelegatingPackResources(
                "bpm-mod-resources",
                true,
                new PackMetadataSection(
                    Component.literal("Loaded mod resources"),
                    SharedConstants.getCurrentVersion().getPackVersion(PackType.CLIENT_RESOURCES)
                ),
                modPacks
            ));
        }

        Path packsFolder = FMLPaths.CONFIGDIR.get()
            .resolve("bluemap")
            .resolve("packs");
        if (Files.isDirectory(packsFolder)) {
            try (var entries = Files.list(packsFolder)) {
                entries
                    .filter(path -> Files.isDirectory(path)
                        || path.getFileName().toString()
                            .toLowerCase(java.util.Locale.ROOT)
                            .endsWith(".zip"))
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .forEach(path -> packs.add(Files.isDirectory(path)
                        ? new PathPackResources("bpm-pack-" + path.getFileName(), path, false)
                        : new FilePackResources("bpm-pack-" + path.getFileName(), path.toFile(), false)));
            }
        }
        return packs;
    }

    private static void publishAtlasTextures(
        MultiPackResourceManager resources,
        Map<ResourceLocation, Resource> atlases,
        Map<ResourceLocation, Resource> sourceTextures,
        Path objectsRoot,
        Map<String, String> textures,
        Map<String, String> metadata
    ) throws IOException {
        for (ResourceLocation atlasId : new TreeMap<>(atlases).keySet()) {
            for (Resource atlas : resources.getResourceStack(atlasId)) {
                JsonObject root;
                try (InputStreamReader reader =
                         new InputStreamReader(atlas.open(), StandardCharsets.UTF_8)) {
                    root = JsonParser.parseReader(reader).getAsJsonObject();
                } catch (RuntimeException exception) {
                    LOGGER.warn("Skipping malformed client atlas {}", atlasId, exception);
                    continue;
                }
                if (!root.has("sources") || !root.get("sources").isJsonArray()) {
                    continue;
                }
                int sourceIndex = 0;
                for (var sourceElement : root.getAsJsonArray("sources")) {
                    try {
                        JsonObject source = sourceElement.getAsJsonObject();
                        String type = source.get("type").getAsString();
                        if (type.startsWith("minecraft:")) {
                            type = type.substring("minecraft:".length());
                        }
                        if ("single".equals(type)) {
                            publishAtlasAlias(source, textures, metadata);
                        } else if ("paletted_permutations".equals(type)) {
                            publishPaletteTextures(
                                source,
                                sourceTextures,
                                objectsRoot,
                                textures,
                                metadata
                            );
                        }
                    } catch (RuntimeException exception) {
                        LOGGER.warn(
                            "Skipping invalid source {} in client atlas {}",
                            sourceIndex,
                            atlasId,
                            exception
                        );
                    }
                    sourceIndex++;
                }
            }
        }
    }

    private static void publishAtlasAlias(
        JsonObject source,
        Map<String, String> textures,
        Map<String, String> metadata
    ) {
        ResourceLocation resource = resourceLocation(source, "resource");
        ResourceLocation sprite = source.has("sprite")
            ? resourceLocation(source, "sprite")
            : resource;
        String object = textures.get(resource.toString());
        if (object != null) {
            textures.put(sprite.toString(), object);
            String animation = metadata.get(resource.toString());
            if (animation == null) {
                metadata.remove(sprite.toString());
            } else {
                metadata.put(sprite.toString(), animation);
            }
        }
    }

    private static void publishPaletteTextures(
        JsonObject source,
        Map<ResourceLocation, Resource> sourceTextures,
        Path objectsRoot,
        Map<String, String> textures,
        Map<String, String> metadata
    ) throws IOException {
        BufferedImage paletteKey = readTexture(
            sourceTextures,
            resourceLocation(source, "palette_key")
        );
        if (paletteKey == null) {
            return;
        }
        int width = paletteKey.getWidth();
        int height = paletteKey.getHeight();
        int[] keys = paletteKey.getRGB(0, 0, width, height, null, 0, width);

        Map<String, Map<Integer, Integer>> palettes = new TreeMap<>();
        for (var permutation : source.getAsJsonObject("permutations").entrySet()) {
            BufferedImage values = readTexture(
                sourceTextures,
                ResourceLocation.tryParse(permutation.getValue().getAsString())
            );
            if (values == null || values.getWidth() != width || values.getHeight() != height) {
                continue;
            }
            int[] colors = values.getRGB(0, 0, width, height, null, 0, width);
            Map<Integer, Integer> palette = new HashMap<>();
            for (int index = 0; index < keys.length; index++) {
                if ((keys[index] >>> 24) != 0) {
                    palette.put(keys[index] & 0x00ffffff, colors[index]);
                }
            }
            palettes.put(permutation.getKey(), palette);
        }

        for (var textureElement : source.getAsJsonArray("textures")) {
            ResourceLocation textureId = ResourceLocation.tryParse(textureElement.getAsString());
            BufferedImage input = readTexture(sourceTextures, textureId);
            if (input == null) {
                continue;
            }
            int inputWidth = input.getWidth();
            int inputHeight = input.getHeight();
            int[] pixels = input.getRGB(
                0,
                0,
                inputWidth,
                inputHeight,
                null,
                0,
                inputWidth
            );
            for (var permutation : palettes.entrySet()) {
                int[] output = pixels.clone();
                for (int index = 0; index < output.length; index++) {
                    int sourceColor = output[index];
                    int sourceAlpha = sourceColor >>> 24;
                    if (sourceAlpha == 0) {
                        continue;
                    }
                    int targetColor = permutation.getValue().getOrDefault(
                        sourceColor & 0x00ffffff,
                        0xff000000 | (sourceColor & 0x00ffffff)
                    );
                    int targetAlpha = targetColor >>> 24;
                    output[index] = ((sourceAlpha * targetAlpha / 255) << 24)
                        | (targetColor & 0x00ffffff);
                }
                BufferedImage image =
                    new BufferedImage(inputWidth, inputHeight, BufferedImage.TYPE_INT_ARGB);
                image.setRGB(0, 0, inputWidth, inputHeight, output, 0, inputWidth);
                ResourceLocation generated =
                    textureId.withSuffix("_" + permutation.getKey());
                textures.put(
                    generated.toString(),
                    publishImageObject(objectsRoot, image)
                );
                metadata.remove(generated.toString());
            }
        }
    }

    private static ResourceLocation resourceLocation(JsonObject object, String key) {
        ResourceLocation location = ResourceLocation.tryParse(object.get(key).getAsString());
        if (location == null) {
            throw new IllegalArgumentException("Invalid resource location in " + key);
        }
        return location;
    }

    private static BufferedImage readTexture(
        Map<ResourceLocation, Resource> textures,
        ResourceLocation id
    ) throws IOException {
        if (id == null) {
            return null;
        }
        Resource resource = textures.get(
            id.withPrefix("textures/").withSuffix(".png")
        );
        if (resource == null) {
            return null;
        }
        try (InputStream input = resource.open()) {
            try {
                return ImageIO.read(input);
            } catch (javax.imageio.IIOException exception) {
                LOGGER.warn("Skipping unreadable client texture {}", id, exception);
                return null;
            }
        }
    }

    private static void publishResources(
        Map<ResourceLocation, Resource> resources,
        String pathPrefix,
        String pathSuffix,
        String objectExtension,
        Path objectsRoot,
        Map<String, String> manifestEntries
    ) throws IOException {
        for (var entry : new TreeMap<>(resources).entrySet()) {
            ResourceLocation id = entry.getKey();
            String path = id.getPath();
            if (!path.startsWith(pathPrefix) || !path.endsWith(pathSuffix)) {
                continue;
            }

            String key = id.getNamespace() + ":"
                + path.substring(pathPrefix.length(), path.length() - pathSuffix.length());
            manifestEntries.put(key, publishResourceObject(objectsRoot, entry.getValue(), objectExtension));
        }
    }

    private static String publishResourceObject(
        Path objectsRoot,
        Resource resource,
        String extension
    ) throws IOException {
        try (InputStream input = resource.open()) {
            return publishResourceObject(objectsRoot, input, extension);
        }
    }

    private static String publishImageObject(
        Path objectsRoot,
        BufferedImage image
    ) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", output)) {
            throw new IOException("PNG encoder is unavailable");
        }
        try (InputStream input = new ByteArrayInputStream(output.toByteArray())) {
            return publishResourceObject(objectsRoot, input, "png");
        }
    }

    private static String publishResourceObject(
        Path objectsRoot,
        InputStream input,
        String extension
    ) throws IOException {
        Path temporary = Files.createTempFile(objectsRoot, ".resource-", ".tmp");
        try {
            MessageDigest digest = sha256();
            try (DigestOutputStream output =
                     new DigestOutputStream(Files.newOutputStream(temporary), digest)) {
                input.transferTo(output);
            }

            String fileName = HexFormat.of().formatHex(digest.digest()) + "." + extension;
            Path target = resolveInside(objectsRoot, fileName);
            if (!Files.isRegularFile(target) || Files.size(target) != Files.size(temporary)) {
                replaceAtomically(temporary, target);
            }
            return "objects/" + fileName;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static String resourceGeneration(
        Map<String, String> models,
        Map<String, String> textures,
        Map<String, String> metadata,
        Map<String, String> atlases
    ) throws IOException {
        MessageDigest digest = sha256();
        digest.update(("format\0" + RESOURCE_MANIFEST_FORMAT + "\0").getBytes(StandardCharsets.UTF_8));
        updateResourceDigest(digest, "models", models);
        updateResourceDigest(digest, "textures", textures);
        updateResourceDigest(digest, "metadata", metadata);
        updateResourceDigest(digest, "atlases", atlases);
        return HexFormat.of().formatHex(digest.digest());
    }

    private static void updateResourceDigest(
        MessageDigest digest,
        String category,
        Map<String, String> resources
    ) {
        digest.update(category.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) 0);
        resources.forEach((key, value) -> {
            digest.update(key.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(value.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
        });
    }

    private static void writeResourceManifest(Path root, ResourceManifest manifest) throws IOException {
        Path target = resolveInside(root, "resource-manifest.json");
        Path temporary = Files.createTempFile(root, ".resource-manifest-", ".tmp");
        try {
            Files.writeString(temporary, GSON.toJson(manifest), StandardCharsets.UTF_8);
            if (!Files.isRegularFile(target) || Files.mismatch(temporary, target) != -1) {
                replaceAtomically(temporary, target);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static Path resolveInside(Path root, String relativePath) throws IOException {
        Path target = root.resolve(relativePath).toAbsolutePath().normalize();
        if (!target.startsWith(root)) {
            throw new IOException("Unsafe resource output path: " + relativePath);
        }
        return target;
    }

    private static MessageDigest sha256() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256 is unavailable", exception);
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
        long generation = apiGeneration;
        if (api == null) {
            return;
        }
        players.keySet().forEach(uuid -> cacheSkin(uuid, null));
        if (!publishing.compareAndSet(false, true)) {
            return;
        }

        List<Publication> publications = new ArrayList<>();
        for (BlueMapMap map : api.getMaps()) {
            List<PlayerData> visible = players.values().stream()
                .filter(player -> map.getWorld().getId().equals(player.worldId))
                .filter(player -> api.getWebApp().getPlayerVisibility(UUID.fromString(player.uuid)))
                .toList();
            List<EntityData> entities = entitiesByWorld.getOrDefault(map.getWorld().getId(), List.of());
            var payload = GSON.toJsonTree(
                new Payload(System.currentTimeMillis(), visible, entities)
            ).getAsJsonObject();
            var jsonPlayers = payload.getAsJsonArray("players");
            for (int index = 0; index < visible.size(); index++) {
                if (!isSkinPublished(map, visible.get(index).skin)) {
                    jsonPlayers.get(index).getAsJsonObject().remove("skin");
                }
            }
            byte[] json = GSON.toJson(payload)
                .getBytes(StandardCharsets.UTF_8);
            publications.add(new Publication(map.getAssetStorage(), json));
        }

        CompletableFuture.runAsync(() -> {
            for (Publication publication : publications) {
                if (!isActiveApi(api, generation)) {
                    return;
                }
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
            if (blueMap != null && !isActiveApi(api, generation)) {
                publish();
            }
        });
    }

    private void loadState() {
        players.clear();
        skinAssets.clear();
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
                UUID uuid = UUID.fromString(player.uuid);
                player.online = false;
                String skinPrefix = SKIN_ASSET_ROOT + "/" + uuid + "-";
                if (player.skin != null
                    && player.skin.startsWith(skinPrefix)
                    && player.skin.endsWith(".png")
                    && !player.skin.contains("..")) {
                    skinAssets.put(uuid, player.skin);
                } else {
                    player.skin = null;
                }
                try {
                    player.skinUrl = player.skinUrl == null
                        ? null
                        : validatedSkinUri(player.skinUrl).toString();
                } catch (RuntimeException exception) {
                    player.skinUrl = null;
                }
                players.put(uuid, player);
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

    private record SkinInfo(URI uri, boolean slim) {
        private static final SkinInfo EMPTY = new SkinInfo(null, false);
    }

    private record Publication(AssetStorage storage, byte[] json) {}

    private record Payload(long updatedAt, List<PlayerData> players, List<EntityData> entities) {}

    private record State(List<PlayerData> players) {}

    private record ResourceManifest(
        int format,
        String generation,
        Map<String, String> models,
        Map<String, String> textures,
        Map<String, String> metadata,
        Map<String, String> atlases
    ) {}

    private static final class PlayerData {
        String uuid;
        String name;
        String worldId;
        String skin;
        String skinUrl;
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
        List<String> tints;
        int count;
        int damage;
        int maxDamage;
        int customModelData;
        float useProgress;
        float trimType;
        float level;
        String armorTexture;
        String armorOverlayTexture;
        String trimTexture;
        boolean glint;
        boolean active;
        boolean charged;
        boolean firework;
        boolean filled;
        boolean cast;
        boolean leftHanded;
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

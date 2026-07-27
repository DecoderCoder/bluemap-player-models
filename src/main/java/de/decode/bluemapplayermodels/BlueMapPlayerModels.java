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
import net.minecraft.server.level.ServerPlayer;
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
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.registries.ForgeRegistries;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.InputStream;
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
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

@Mod(BlueMapPlayerModels.MOD_ID)
public final class BlueMapPlayerModels {
    public static final String MOD_ID = "bluemap_player_models";

    private static final Logger LOGGER = LogUtils.getLogger();
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private static final String ASSET_ROOT = "bluemap-player-models";
    private static final String PLAYER_DATA_ASSET = ASSET_ROOT + "/players.json";
    private static final byte[] PNG_HEADER = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

    private final Map<UUID, PlayerData> players = new ConcurrentHashMap<>();
    private final AtomicBoolean publishing = new AtomicBoolean();
    private final java.util.Set<UUID> downloadingSkins = ConcurrentHashMap.newKeySet();

    private volatile BlueMapAPI blueMap;
    private volatile Path skinRoot;
    private MinecraftServer server;
    private Path stateFile;
    private int ticks;

    public BlueMapPlayerModels() {
        MinecraftForge.EVENT_BUS.register(this);
        BlueMapAPI.onEnable(this::enableBlueMap);
        BlueMapAPI.onDisable(api -> {
            if (blueMap == api) {
                blueMap = null;
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
        publish();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        event.getServer().getPlayerList().getPlayers().forEach(player -> snapshot(player, false));
        saveState();
        server = null;
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
        publish();
    }

    private void enableBlueMap(BlueMapAPI api) {
        try {
            Path root = api.getWebApp().getWebRoot();
            copyResource("/web/player-models.js", root.resolve(ASSET_ROOT).resolve("player-models.js"));
            copyResource("/web/player-models.css", root.resolve(ASSET_ROOT).resolve("player-models.css"));
            api.getWebApp().registerScript(ASSET_ROOT + "/player-models.js");
            api.getWebApp().registerStyle(ASSET_ROOT + "/player-models.css");
            skinRoot = Files.createDirectories(root.resolve(ASSET_ROOT).resolve("skins"));
            blueMap = api;
            publish();
            LOGGER.info("BlueMap Player Models web assets installed");
        } catch (IOException exception) {
            LOGGER.error("Failed to install BlueMap Player Models web assets", exception);
        }
    }

    private static void copyResource(String resource, Path target) throws IOException {
        Files.createDirectories(target.getParent());
        try (InputStream input = BlueMapPlayerModels.class.getResourceAsStream(resource)) {
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

        SkinInfo skin = skinInfo(player);
        data.slim = skin.slim;
        data.skin = ASSET_ROOT + "/skins/" + data.uuid + ".png";
        if (skin.url != null) {
            downloadSkin(player.getUUID(), skin.url);
        }

        data.mainHand = item(player.getMainHandItem());
        data.offHand = item(player.getOffhandItem());
        data.armor = List.of(
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
            URI url = validatedSkinUri(skin.get("url").getAsString());
            boolean slim = skin.has("metadata")
                && "slim".equals(skin.getAsJsonObject("metadata").get("model").getAsString());
            return new SkinInfo(url, slim);
        } catch (RuntimeException exception) {
            LOGGER.debug("Invalid skin metadata for {}", player.getGameProfile().getName(), exception);
            return SkinInfo.EMPTY;
        }
    }

    private static URI validatedSkinUri(String value) {
        URI uri = URI.create(value);
        if (!"textures.minecraft.net".equalsIgnoreCase(uri.getHost())) {
            throw new IllegalArgumentException("Unexpected skin host");
        }
        if ("http".equalsIgnoreCase(uri.getScheme())) {
            return URI.create("https://" + uri.getHost() + uri.getRawPath());
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("Unexpected skin protocol");
        }
        return uri;
    }

    private void downloadSkin(UUID uuid, URI uri) {
        Path root = skinRoot;
        if (root == null) {
            return;
        }

        Path target = root.resolve(uuid + ".png");
        if (Files.exists(target) || !downloadingSkins.add(uuid)) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            try {
                HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(15))
                    .GET()
                    .build();
                HttpResponse<byte[]> response = HTTP.send(request, HttpResponse.BodyHandlers.ofByteArray());
                byte[] png = response.body();
                if (response.statusCode() != 200 || png.length > 2_000_000 || !hasPngHeader(png)) {
                    throw new IOException("Invalid skin response: HTTP " + response.statusCode());
                }

                Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
                Files.write(temporary, png);
                replaceAtomically(temporary, target);
            } catch (IOException exception) {
                LOGGER.warn("Failed to cache skin for {}", uuid, exception);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            } finally {
                downloadingSkins.remove(uuid);
            }
        });
    }

    private static boolean hasPngHeader(byte[] bytes) {
        if (bytes.length < PNG_HEADER.length) {
            return false;
        }
        for (int i = 0; i < PNG_HEADER.length; i++) {
            if (bytes[i] != PNG_HEADER[i]) {
                return false;
            }
        }
        return true;
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
                .filter(player -> !player.online || api.getWebApp().getPlayerVisibility(UUID.fromString(player.uuid)))
                .toList();
            byte[] json = GSON.toJson(new Payload(System.currentTimeMillis(), visible))
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
        }).whenComplete((ignored, error) -> {
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

    private record SkinInfo(URI url, boolean slim) {
        private static final SkinInfo EMPTY = new SkinInfo(null, false);
    }

    private record Publication(AssetStorage storage, byte[] json) {}

    private record Payload(long updatedAt, List<PlayerData> players) {}

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
}

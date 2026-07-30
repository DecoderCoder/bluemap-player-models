package de.decode.bluemapplayermodels;

import com.google.gson.JsonObject;
import net.minecraftforge.common.ForgeConfigSpec;

import java.util.List;

final class BlueMapPlayerModelsConfig {
    private static final ForgeConfigSpec.Builder BUILDER = new ForgeConfigSpec.Builder();

    private static final ForgeConfigSpec.BooleanValue PLAYER_MODELS;
    private static final ForgeConfigSpec.BooleanValue ANIMATE_PLAYERS;
    private static final ForgeConfigSpec.BooleanValue ARMOR;
    private static final ForgeConfigSpec.BooleanValue OFFLINE_PLAYERS;
    private static final ForgeConfigSpec.BooleanValue ENTITIES;
    private static final ForgeConfigSpec.BooleanValue LABELS;
    private static final ForgeConfigSpec.BooleanValue PLAYER_VITALS;
    private static final ForgeConfigSpec.BooleanValue REAL_TIME_PLAYERS;
    private static final ForgeConfigSpec.ConfigValue<Integer> PLAYER_REFRESH_MS;
    private static final ForgeConfigSpec.ConfigValue<Integer> ENTITY_REFRESH_MS;

    static final ForgeConfigSpec SPEC;

    static {
        BUILDER.comment(
            "Default browser settings for new visitors.",
            "Visitors can still override these values in the Player Models panel."
        ).push("defaults");
        PLAYER_MODELS = BUILDER.comment("Show 3D player models.")
            .define("playerModels", true);
        ANIMATE_PLAYERS = BUILDER.comment("Animate walking, running, crouching, and mining.")
            .define("animatePlayers", true);
        ARMOR = BUILDER.comment("Show equipped armor layers.")
            .define("armor", true);
        OFFLINE_PLAYERS = BUILDER.comment("Keep logout positions in gray.")
            .define("offlinePlayers", true);
        ENTITIES = BUILDER.comment("Show loaded non-player entities.")
            .define("entities", true);
        LABELS = BUILDER.comment("Show player labels.")
            .define("labels", true);
        PLAYER_VITALS = BUILDER.comment("Show health and hunger below online player names.")
            .define("playerVitals", false);
        REAL_TIME_PLAYERS = BUILDER.comment("Use real-time online-player movement.")
            .define("realTimePlayers", true);
        PLAYER_REFRESH_MS = BUILDER.comment(
            "Player refresh interval in milliseconds: 1000, 2000, 5000, 10000, or 30000."
        )
            .defineInList("playerRefreshMs", 1000, List.of(1000, 2000, 5000, 10000, 30000));
        ENTITY_REFRESH_MS = BUILDER.comment(
            "Entity refresh interval in milliseconds: 1000, 2000, 5000, 10000, or 30000."
        )
            .defineInList("entityRefreshMs", 1000, List.of(1000, 2000, 5000, 10000, 30000));
        BUILDER.pop();
        SPEC = BUILDER.build();
    }

    private BlueMapPlayerModelsConfig() {
    }

    static JsonObject browserDefaults() {
        JsonObject defaults = new JsonObject();
        defaults.addProperty("playerModels", PLAYER_MODELS.get());
        defaults.addProperty("animatePlayers", ANIMATE_PLAYERS.get());
        defaults.addProperty("armor", ARMOR.get());
        defaults.addProperty("offlinePlayers", OFFLINE_PLAYERS.get());
        defaults.addProperty("entities", ENTITIES.get());
        defaults.addProperty("labels", LABELS.get());
        defaults.addProperty("playerVitals", PLAYER_VITALS.get());
        defaults.addProperty("realTimePlayers", REAL_TIME_PLAYERS.get());
        defaults.addProperty("playerRefreshMs", PLAYER_REFRESH_MS.get());
        defaults.addProperty("entityRefreshMs", ENTITY_REFRESH_MS.get());
        return defaults;
    }
}

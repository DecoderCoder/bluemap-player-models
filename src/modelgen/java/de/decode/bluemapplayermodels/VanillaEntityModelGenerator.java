package de.decode.bluemapplayermodels;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

public final class VanillaEntityModelGenerator {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final Set<String> REQUIRED_MODELS = Set.of(
        "minecraft:bee",
        "minecraft:chicken",
        "minecraft:cow",
        "minecraft:pig",
        "minecraft:pufferfish_big",
        "minecraft:tropical_fish_large"
    );
    private static final Map<String, Float> MODEL_SCALES = Map.ofEntries(
        Map.entry("minecraft:bat", 0.35F),
        Map.entry("minecraft:cat", 0.8F),
        Map.entry("minecraft:cave_spider", 0.7F),
        Map.entry("minecraft:donkey", 0.87F),
        Map.entry("minecraft:elder_guardian", 2.35F),
        Map.entry("minecraft:evoker", 0.9375F),
        Map.entry("minecraft:ghast", 4.5F),
        Map.entry("minecraft:giant", 6F),
        Map.entry("minecraft:horse", 1.1F),
        Map.entry("minecraft:husk", 1.0625F),
        Map.entry("minecraft:illusioner", 0.9375F),
        Map.entry("minecraft:mule", 0.92F),
        Map.entry("minecraft:pillager", 0.9375F),
        Map.entry("minecraft:polar_bear", 1.2F),
        Map.entry("minecraft:villager", 0.9375F),
        Map.entry("minecraft:vindicator", 0.9375F),
        Map.entry("minecraft:wandering_trader", 0.9375F),
        Map.entry("minecraft:witch", 0.9375F),
        Map.entry("minecraft:wither", 2F),
        Map.entry("minecraft:wither_skeleton", 1.2F)
    );
    // ponytail: bake each renderer's translation/rotation/scale before enabling these meshes.
    private static final Set<String> SPECIAL_RENDERER_MODELS = Set.of(
        "minecraft:boat/oak",
        "minecraft:chest_boat/oak",
        "minecraft:chest_minecart",
        "minecraft:command_block_minecart",
        "minecraft:end_crystal",
        "minecraft:ender_dragon",
        "minecraft:evoker_fangs",
        "minecraft:furnace_minecart",
        "minecraft:hopper_minecart",
        "minecraft:leash_knot",
        "minecraft:llama_spit",
        "minecraft:magma_cube",
        "minecraft:minecart",
        "minecraft:phantom",
        "minecraft:shulker",
        "minecraft:shulker_bullet",
        "minecraft:slime",
        "minecraft:spawner_minecart",
        "minecraft:tnt_minecart",
        "minecraft:trident",
        "minecraft:wither_skull"
    );

    private VanillaEntityModelGenerator() {}

    @SuppressWarnings("deprecation")
    public static void main(String[] arguments) throws IOException {
        if (arguments.length != 1) {
            throw new IllegalArgumentException("Expected the output JSON path");
        }

        SharedConstants.tryDetectVersion();
        bootstrapVanillaRegistries();

        Map<String, JsonObject> generated = new TreeMap<>();
        for (var entry : LayerDefinitions.createRoots().entrySet()) {
            ModelLayerLocation location = entry.getKey();
            if (!"main".equals(location.getLayer())
                || !"minecraft".equals(location.getModel().getNamespace())) {
                continue;
            }

            String modelId = location.getModel().toString();
            if (SPECIAL_RENDERER_MODELS.contains(modelId)
                || (!BuiltInRegistries.ENTITY_TYPE.containsKey(location.getModel())
                && !REQUIRED_MODELS.contains(modelId))) {
                continue;
            }

            GeometryCollector geometry = new GeometryCollector(
                MODEL_SCALES.getOrDefault(modelId, 1F)
            );
            entry.getValue().bakeRoot().render(new PoseStack(), geometry, 0, 0);
            if (!geometry.isEmpty()) {
                generated.put(modelId, geometry.toJson());
            }
        }

        if (!generated.keySet().containsAll(REQUIRED_MODELS)) {
            throw new IllegalStateException(
                "Missing required vanilla entity models: "
                    + REQUIRED_MODELS.stream().filter(model -> !generated.containsKey(model)).toList()
            );
        }

        JsonObject models = new JsonObject();
        generated.forEach(models::add);
        JsonObject root = new JsonObject();
        root.addProperty("format", 1);
        root.addProperty("minecraft", "1.20.1");
        root.add("models", models);

        Path output = Path.of(arguments[0]).toAbsolutePath().normalize();
        Files.createDirectories(output.getParent());
        Files.writeString(output, GSON.toJson(root), StandardCharsets.UTF_8);
        System.out.printf(
            "Generated %,d vanilla model layers at %s%n",
            generated.size(),
            output
        );
    }

    private static void bootstrapVanillaRegistries() {
        try {
            Bootstrap.bootStrap();
        } catch (ExceptionInInitializerError error) {
            if (BuiltInRegistries.REGISTRY.keySet().isEmpty()
                || !causedBy(error, NoSuchMethodException.class)) {
                throw error;
            }
            // Forge's final networking hook needs ModLauncher transformations.
            // Vanilla registries are already complete and are all this build-only task uses.
        }
    }

    private static boolean causedBy(Throwable error, Class<? extends Throwable> type) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (type.isInstance(current)) {
                return true;
            }
        }
        return false;
    }

    private static final class GeometryCollector implements VertexConsumer {
        private final JsonArray positions = new JsonArray();
        private final JsonArray uvs = new JsonArray();
        private final float[][] quad = new float[4][5];
        private final float scale;
        private int quadVertex;
        private float x;
        private float y;
        private float z;
        private float u;
        private float v;

        private GeometryCollector(float scale) {
            this.scale = scale;
        }

        @Override
        public VertexConsumer vertex(double x, double y, double z) {
            this.x = (float) x;
            this.y = (float) y;
            this.z = (float) z;
            return this;
        }

        @Override
        public VertexConsumer color(int red, int green, int blue, int alpha) {
            return this;
        }

        @Override
        public VertexConsumer uv(float u, float v) {
            this.u = u;
            this.v = v;
            return this;
        }

        @Override
        public VertexConsumer overlayCoords(int u, int v) {
            return this;
        }

        @Override
        public VertexConsumer uv2(int u, int v) {
            return this;
        }

        @Override
        public VertexConsumer normal(float x, float y, float z) {
            return this;
        }

        @Override
        public void endVertex() {
            quad[quadVertex][0] = x * scale;
            quad[quadVertex][1] = (1.501F - y) * scale;
            quad[quadVertex][2] = -z * scale;
            quad[quadVertex][3] = u;
            quad[quadVertex][4] = 1F - v;
            if (++quadVertex == 4) {
                addTriangle(0, 1, 2);
                addTriangle(0, 2, 3);
                quadVertex = 0;
            }
        }

        @Override
        public void defaultColor(int red, int green, int blue, int alpha) {}

        @Override
        public void unsetDefaultColor() {}

        private void addTriangle(int first, int second, int third) {
            addVertex(quad[first]);
            addVertex(quad[second]);
            addVertex(quad[third]);
        }

        private void addVertex(float[] vertex) {
            positions.add(clean(vertex[0]));
            positions.add(clean(vertex[1]));
            positions.add(clean(vertex[2]));
            uvs.add(clean(vertex[3]));
            uvs.add(clean(vertex[4]));
        }

        private boolean isEmpty() {
            return positions.isEmpty();
        }

        private JsonObject toJson() {
            if (quadVertex != 0) {
                throw new IllegalStateException("Vanilla model emitted an incomplete quad");
            }
            JsonObject model = new JsonObject();
            model.add("positions", positions);
            model.add("uvs", uvs);
            return model;
        }

        private static double clean(float value) {
            double rounded = Math.rint(value * 1_000_000D) / 1_000_000D;
            return rounded == -0D ? 0D : rounded;
        }
    }
}

package de.decode.bluemapplayermodels;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.IExtensionPoint;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

@Mod(BlueMapPlayerModels.MOD_ID)
public final class BlueMapPlayerModels {
    public static final String MOD_ID = "bluemap_player_models";

    public BlueMapPlayerModels(FMLJavaModLoadingContext context) {
        context.registerDisplayTest(IExtensionPoint.DisplayTest.IGNORE_SERVER_VERSION);
        DistExecutor.unsafeRunWhenOn(Dist.DEDICATED_SERVER, () -> BlueMapPlayerModelsServer::new);
    }
}

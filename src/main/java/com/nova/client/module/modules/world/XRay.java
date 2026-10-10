package com.nova.client.module.modules.world;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.module.modules.render.EspBlocks;
import com.nova.client.settings.StringSetting;
import net.minecraft.world.level.block.Block;

import java.util.Set;

/**
 * XRay : rend les blocs non-listés transparents (via XRayMixin sur canOcclude).
 * Recharge les chunks à l'activation. NOTE : Sodium peut ignorer canOcclude ;
 * dans ce cas OreEsp est l'alternative fiable.
 */
public class XRay extends Module {
    private static XRay instance;

    private final StringSetting whitelist = addSetting(new StringSetting(
            "Whitelist", "Blocs visibles (virgules)", "minecraft:diamond_ore,minecraft:ancient_debris,minecraft:gold_ore"));

    public XRay() { super("XRay", "Voir à travers les blocs", Category.WORLD); instance = this; }

    public static boolean isActive() { return instance != null && instance.isEnabled(); }

    public static boolean isVisible(Block b) {
        if (instance == null) return true;
        Set<Block> set = com.nova.client.module.modules.render.EspBlocks.parse(instance.whitelist.get());
        return set.contains(b);
    }

    @Override
    protected void onEnable() { reload(); }
    @Override
    protected void onDisable() { reload(); }

    private void reload() {
        if (mc.levelRenderer != null) mc.levelRenderer.allChanged();
    }
}

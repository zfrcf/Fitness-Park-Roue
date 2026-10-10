package com.nova.client.util;

import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.player.Player;

/** Utilitaires de combat : dégâts estimés, trous, sécurité. */
public final class CombatUtil {
    private CombatUtil() {}

    /** true si le joueur est dans un "hole" (entouré de bedrock/obsidian). */
    public static boolean isInHole(Player p) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return false;
        BlockPos pos = p.blockPosition();
        for (var dir : new BlockPos[]{pos.north(), pos.south(), pos.east(), pos.west(), pos.below()}) {
            var state = mc.level.getBlockState(dir);
            if (!state.isSolidRender()) return false;
            float hardness = state.getBlock().defaultDestroyTime();
            if (hardness < 0) continue; // bedrock
            if (hardness < 50f) return false; // moins dur que l'obsidienne
        }
        return true;
    }
}

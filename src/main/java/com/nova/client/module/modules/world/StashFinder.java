package com.nova.client.module.modules.world;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.entity.ShulkerBoxBlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** StashFinder : détecte les chunks avec beaucoup de conteneurs (stashs cachés). */
public class StashFinder extends Module {
    private final IntSetting threshold = addSetting(new IntSetting("Threshold", "Conteneurs min pour alerter", 8, 2, 100));

    private final Set<Long> seen = new HashSet<>();
    private int timer;

    public StashFinder() { super("StashFinder", "Détecte les stashs (conteneurs groupés)", Category.WORLD); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null) return;
        if (timer-- > 0) return;
        timer = 40;
        int pcx = mc.player.blockPosition().getX() >> 4;
        int pcz = mc.player.blockPosition().getZ() >> 4;
        for (int cx = pcx - 4; cx <= pcx + 4; cx++)
            for (int cz = pcz - 4; cz <= pcz + 4; cz++) {
                long key = ((long) cx << 32) | (cz & 0xFFFFFFFFL);
                if (seen.contains(key)) continue;
                LevelChunk chunk;
                try { chunk = mc.level.getChunk(cx, cz); } catch (Throwable t) { continue; }
                if (chunk == null) continue;
                int containers = 0;
                for (Map.Entry<BlockPos, BlockEntity> en : chunk.getBlockEntities().entrySet()) {
                    BlockEntity be = en.getValue();
                    if (be instanceof ChestBlockEntity || be instanceof BarrelBlockEntity
                            || be instanceof ShulkerBoxBlockEntity) containers++;
                }
                if (containers >= threshold.get()) {
                    seen.add(key);
                    mc.player.sendSystemMessage(Component.literal(
                            "§5[Nova]§r §eStash détecté §7(" + containers + " conteneurs) en §b" + (cx * 16) + " " + (cz * 16)));
                }
            }
    }
}

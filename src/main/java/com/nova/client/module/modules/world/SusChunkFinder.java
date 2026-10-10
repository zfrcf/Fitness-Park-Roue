package com.nova.client.module.modules.world;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SpawnerBlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Détecte les chunks suspects (spawners, forte densité de block entities). */
public class SusChunkFinder extends Module {
    private final IntSetting threshold = addSetting(new IntSetting("Threshold", "Seuil d'alerte", 5, 1, 50));

    private final Set<Long> seen = new HashSet<>();
    private int timer;

    public SusChunkFinder() { super("SusChunkFinder", "Détecte les chunks suspects", Category.WORLD); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null) return;
        if (timer-- > 0) return;
        timer = 40;
        int pcx = mc.player.blockPosition().getX() >> 4;
        int pcz = mc.player.blockPosition().getZ() >> 4;
        for (int cx = pcx - 3; cx <= pcx + 3; cx++)
            for (int cz = pcz - 3; cz <= pcz + 3; cz++) {
                long key = ((long) cx << 32) | (cz & 0xFFFFFFFFL);
                if (seen.contains(key)) continue;
                LevelChunk chunk;
                try { chunk = mc.level.getChunk(cx, cz); } catch (Throwable t) { continue; }
                if (chunk == null) continue;
                int spawners = 0, total = 0;
                for (Map.Entry<BlockPos, BlockEntity> en : chunk.getBlockEntities().entrySet()) {
                    total++;
                    if (en.getValue() instanceof SpawnerBlockEntity) spawners++;
                }
                if (spawners > 0 || total >= threshold.get()) {
                    seen.add(key);
                    mc.player.sendSystemMessage(Component.literal(
                            "§5[Nova]§r §eChunk suspect §7(" + spawners + " spawners, " + total
                                    + " block entities) en §b" + (cx * 16) + " " + (cz * 16)));
                }
            }
    }
}

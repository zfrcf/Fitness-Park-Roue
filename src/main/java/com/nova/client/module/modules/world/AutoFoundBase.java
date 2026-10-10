package com.nova.client.module.modules.world;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import com.nova.client.waypoint.WaypointManager;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * AutoFoundBase : repère les bases (blocs posés par des joueurs : torches,
 * conteneurs, blocs de construction) et crée un waypoint automatiquement.
 */
public class AutoFoundBase extends Module {
    private final IntSetting threshold = addSetting(new IntSetting("Threshold", "Score min pour alerter", 15, 3, 200));
    private final IntSetting rangeChunks = addSetting(new IntSetting("Range", "Rayon en chunks", 4, 1, 8));

    private final Set<Long> seen = new HashSet<>();
    private int timer;

    public AutoFoundBase() { super("AutoFoundBase", "Repère les bases et crée un waypoint", Category.WORLD); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null) return;
        if (timer-- > 0) return;
        timer = 60;
        ChunkPos pc = mc.player.chunkPosition();
        int r = rangeChunks.get();
        for (int cx = pc.x - r; cx <= pc.x + r; cx++)
            for (int cz = pc.z - r; cz <= pc.z + r; cz++) {
                long key = ChunkPos.asLong(cx, cz);
                if (seen.contains(key)) continue;
                LevelChunk chunk;
                try { chunk = mc.level.getChunk(cx, cz); } catch (Throwable t) { continue; }
                if (chunk == null) continue;

                int score = 0;
                // Conteneurs / block entities = fort indice de base
                for (Map.Entry<BlockPos, BlockEntity> en : chunk.getBlockEntities().entrySet()) score += 3;
                // Torches et blocs manufacturés dans les sections
                for (LevelChunkSection sec : chunk.getSections()) {
                    if (sec == null || sec.hasOnlyAir()) continue;
                    for (int x = 0; x < 16; x++) for (int y = 0; y < 16; y++) for (int z = 0; z < 16; z++) {
                        var st = sec.getBlockState(x, y, z);
                        if (st.isAir()) continue;
                        if (st.is(Blocks.TORCH) || st.is(Blocks.WALL_TORCH) || st.is(Blocks.CRAFTING_TABLE)
                                || st.is(Blocks.FURNACE) || st.is(Blocks.LADDER) || st.is(Blocks.OAK_PLANKS)) score++;
                    }
                }
                if (score >= threshold.get()) {
                    seen.add(key);
                    BlockPos center = new BlockPos(cx * 16 + 8, mc.player.getBlockY(), cz * 16 + 8);
                    WaypointManager.add("Base " + cx + "," + cz, center);
                    if (mc.player != null) mc.player.sendSystemMessage(net.minecraft.network.chat.Component.literal(
                            "§5[Nova]§r §dBase détectée §7(score " + score + ") en §b" + center.getX() + " " + center.getZ()
                                    + " §7→ waypoint créé"));
                }
            }
    }
}

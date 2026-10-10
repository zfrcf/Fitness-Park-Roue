package com.nova.client.module.modules.world;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import com.nova.client.waypoint.WaypointManager;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;

import java.util.HashSet;
import java.util.Set;

/**
 * AutoFoundBase : repère les bases (blocs posés par des joueurs) et crée un waypoint.
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
        int pcx = mc.player.blockPosition().getX() >> 4;
        int pcz = mc.player.blockPosition().getZ() >> 4;
        int r = rangeChunks.get();

        for (int cx = pcx - r; cx <= pcx + r; cx++) {
            for (int cz = pcz - r; cz <= pcz + r; cz++) {
                long key = ((long) cx << 32) | (cz & 0xFFFFFFFFL);
                if (seen.contains(key)) continue;
                LevelChunk chunk;
                try { chunk = mc.level.getChunk(cx, cz); } catch (Throwable t) { continue; }
                if (chunk == null) continue;

                int score = 0;
                for (BlockEntity be : chunk.getBlockEntities().values()) {
                    if (be instanceof net.minecraft.world.level.block.entity.ChestBlockEntity
                            || be instanceof net.minecraft.world.level.block.entity.BarrelBlockEntity
                            || be instanceof net.minecraft.world.level.block.entity.SpawnerBlockEntity) {
                        score += 2;
                    }
                }
                for (LevelChunkSection section : chunk.getSections()) {
                    if (section == null || section.hasOnlyAir()) continue;
                    for (int x = 0; x < 16; x++)
                        for (int z = 0; z < 16; z++)
                            for (int y = 0; y < 16; y++) {
                                var state = section.getBlockState(x, y, z);
                                if (state.getBlock() == Blocks.SMOOTH_STONE_SLAB
                                        || state.getBlock() == Blocks.OAK_FENCE
                                        || state.getBlock() == Blocks.STONE_BRICKS
                                        || state.getBlock() == Blocks.GLASS
                                        || state.getBlock() == Blocks.IRON_DOOR
                                        || state.getBlock() == Blocks.DARK_OAK_FENCE) {
                                    score++;
                                }
                            }
                }

                if (score >= threshold.get()) {
                    seen.add(key);
                    int bx = cx * 16 + 8;
                    int bz = cz * 16 + 8;
                    mc.player.sendSystemMessage(Component.literal(
                            "§5[Nova]§r §eBase potentielle §7(score §b" + score + "§7) en §b" + bx + " " + bz));
                    WaypointManager.add("Base " + bx + "_" + bz, new BlockPos(bx, 64, bz));
                }
            }
        }
    }
}

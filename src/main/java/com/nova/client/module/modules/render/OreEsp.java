package com.nova.client.module.modules.render;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;

import java.util.Set;

/** ESP des minerais (liste fixe des minerais vanilla). */
public class OreEsp extends AbstractBlockEsp {
    private static final Set<Block> ORES = Set.of(
            Blocks.COAL_ORE, Blocks.DEEPSLATE_COAL_ORE,
            Blocks.IRON_ORE, Blocks.DEEPSLATE_IRON_ORE,
            Blocks.COPPER_ORE, Blocks.DEEPSLATE_COPPER_ORE,
            Blocks.GOLD_ORE, Blocks.DEEPSLATE_GOLD_ORE,
            Blocks.REDSTONE_ORE, Blocks.DEEPSLATE_REDSTONE_ORE,
            Blocks.LAPIS_ORE, Blocks.DEEPSLATE_LAPIS_ORE,
            Blocks.DIAMOND_ORE, Blocks.DEEPSLATE_DIAMOND_ORE,
            Blocks.EMERALD_ORE, Blocks.DEEPSLATE_EMERALD_ORE,
            Blocks.NETHER_QUARTZ_ORE, Blocks.NETHER_GOLD_ORE, Blocks.ANCIENT_DEBRIS);

    public OreEsp() { super("OreEsp", "ESP des minerais"); color.set(EspColor.YELLOW); }

    @Override
    protected void scan() {
        BlockPos c = mc.player.blockPosition();
        int r = rangeChunks.get();
        int pcx = c.getX() >> 4, pcz = c.getZ() >> 4;
        for (int cx = pcx - r; cx <= pcx + r; cx++)
            for (int cz = pcz - r; cz <= pcz + r; cz++) {
                LevelChunk chunk;
                try { chunk = mc.level.getChunk(cx, cz); } catch (Throwable t) { continue; }
                if (chunk == null) continue;
                for (LevelChunkSection sec : chunk.getSections()) {
                    if (sec == null || sec.hasOnlyAir()) continue;
                    BlockPos o = sec.getSectionOrigin();
                    for (int x = 0; x < 16; x++) for (int y = 0; y < 16; y++) for (int z = 0; z < 16; z++) {
                        BlockState st = sec.getBlockState(x, y, z);
                        if (!st.isAir() && ORES.contains(st.getBlock()))
                            add(new BlockPos(o.getX() + x, o.getY() + y, o.getZ() + z));
                    }
                }
            }
    }
}

package com.nova.client.module.modules.render;

import com.nova.client.settings.StringSetting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;

import java.util.HashSet;
import java.util.Set;

/** ESP de blocs personnalisables (ids séparés par des virgules). */
public class EspBlocks extends AbstractBlockEsp {
    private final StringSetting blocks = addSetting(new StringSetting(
            "Blocks", "IDs de blocs (virgules)", "minecraft:diamond_ore,minecraft:ancient_debris"));

    public EspBlocks() { super("EspBlocks", "ESP de blocs au choix"); }

    @Override
    protected void scan() {
        Set<Block> targets = parse(blocks.get());
        if (targets.isEmpty()) return;
        scanSections(st -> targets.contains(st.getBlock()));
    }

    private void scanSections(java.util.function.Predicate<BlockState> match) {
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
                        if (!st.isAir() && match.test(st)) add(new BlockPos(o.getX() + x, o.getY() + y, o.getZ() + z));
                    }
                }
            }
    }

    static Set<Block> parse(String csv) {
        Set<Block> out = new HashSet<>();
        for (String s : csv.split(",")) {
            s = s.trim();
            if (s.isEmpty()) continue;
            if (!s.contains(":")) s = "minecraft:" + s;
            try {
                BuiltInRegistries.BLOCK.get(Identifier.parse(s)).map(h -> h.value()).ifPresent(out::add);
            } catch (Throwable ignored) {}
        }
        return out;
    }
}

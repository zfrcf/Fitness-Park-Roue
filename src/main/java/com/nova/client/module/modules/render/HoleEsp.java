package com.nova.client.module.modules.render;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Blocks;

/** ESP des trous (safe spots) : bedrock = vert, obsidienne = orange. */
public class HoleEsp extends AbstractBlockEsp {
    public HoleEsp() { super("HoleEsp", "ESP des trous de protection"); color.set(EspColor.GREEN); }

    @Override
    protected void scan() {
        BlockPos c = mc.player.blockPosition();
        int r = rangeChunks.get() * 8;
        for (int x = -r; x <= r; x++) for (int y = -6; y <= 6; y++) for (int z = -r; z <= r; z++) {
            BlockPos p = c.offset(x, y, z);
            if (!mc.level.getBlockState(p).isAir()) continue;
            if (!mc.level.getBlockState(p.above()).isAir()) continue;
            if (isHole(p)) add(p);
        }
    }

    private boolean isHole(BlockPos p) {
        BlockPos[] sides = {p.north(), p.south(), p.east(), p.west(), p.below()};
        for (BlockPos s : sides) {
            var st = mc.level.getBlockState(s);
            if (!st.is(Blocks.OBSIDIAN) && !st.is(Blocks.BEDROCK)) return false;
        }
        return true;
    }
}

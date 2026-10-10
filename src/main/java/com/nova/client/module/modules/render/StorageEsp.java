package com.nova.client.module.modules.render;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.entity.DispenserBlockEntity;
import net.minecraft.world.level.block.entity.HopperBlockEntity;
import net.minecraft.world.level.block.entity.ShulkerBoxBlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.Map;

/** ESP des conteneurs (coffres, barils, shulkers, entonnoirs, fours). */
public class StorageEsp extends AbstractBlockEsp {
    public StorageEsp() { super("StorageEsp", "ESP des conteneurs"); color.set(EspColor.ORANGE); }

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
                for (Map.Entry<BlockPos, BlockEntity> en : chunk.getBlockEntities().entrySet()) {
                    BlockEntity be = en.getValue();
                    if (be instanceof ChestBlockEntity || be instanceof BarrelBlockEntity
                            || be instanceof ShulkerBoxBlockEntity || be instanceof HopperBlockEntity
                            || be instanceof DispenserBlockEntity || be instanceof AbstractFurnaceBlockEntity) {
                        add(en.getKey());
                    }
                }
            }
    }
}

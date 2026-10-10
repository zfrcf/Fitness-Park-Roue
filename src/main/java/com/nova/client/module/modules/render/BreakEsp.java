package com.nova.client.module.modules.render;

import net.minecraft.core.BlockPos;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** ESP des blocs en cours de destruction (alimenté par BreakEspMixin). */
public class BreakEsp extends AbstractBlockEsp {
    private static final Map<BlockPos, Long> BREAKING = new ConcurrentHashMap<>();
    private static final long DURATION_MS = 1500;

    public BreakEsp() { super("BreakEsp", "ESP des blocs cassés"); color.set(EspColor.RED); }

    public static void record(BlockPos pos) {
        BREAKING.put(pos.immutable(), System.currentTimeMillis());
    }

    @Override
    protected void scan() {
        long now = System.currentTimeMillis();
        BREAKING.entrySet().removeIf(en -> now - en.getValue() > DURATION_MS);
        for (BlockPos p : BREAKING.keySet()) add(p);
    }
}

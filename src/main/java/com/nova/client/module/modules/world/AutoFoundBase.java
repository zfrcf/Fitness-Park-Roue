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
import java.util.Map;
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
        int

package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.render.RenderUtil;
import com.nova.client.waypoint.WaypointManager;
import net.minecraft.core.BlockPos;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Supplier;

/** Waypoints : affiche une boîte sur chaque waypoint. Gestion via .wp add/del/list. */
public class Waypoints extends Module {
    private final Supplier<Collection<BlockPos>> positions = () -> {
        List<BlockPos> out = new ArrayList<>();
        for (WaypointManager.Waypoint w : WaypointManager.getAll()) out.add(w.pos());
        return out;
    };
    private final Supplier<float[]> color = () -> new float[]{0.8f, 0.2f, 1f, 1f};

    public Waypoints() { super("Waypoints", "Affiche les waypoints (.wp add/del/list)", Category.RENDER); }

    @Override protected void onEnable() { RenderUtil.register(this, positions, color); }
    @Override protected void onDisable() { RenderUtil.unregister(this); }
}

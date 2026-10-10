package com.nova.client.waypoint;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.nova.client.NovaClient;
import net.minecraft.core.BlockPos;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Waypoints persistés en JSON (.minecraft/nova/waypoints.json). */
public final class WaypointManager {
    public record Waypoint(String name, int x, int y, int z) {
        public BlockPos pos() { return new BlockPos(x, y, z); }
    }

    private static final Gson GSON = new Gson();
    private static final List<Waypoint> WAYPOINTS = new CopyOnWriteArrayList<>();
    private static File file;

    private WaypointManager() {}

    public static void init(File dir) {
        file = new File(dir, "waypoints.json");
        load();
    }

    public static void add(String name, BlockPos pos) {
        WAYPOINTS.add(new Waypoint(name, pos.getX(), pos.getY(), pos.getZ()));
        save();
    }

    public static boolean remove(String name) {
        boolean ok = WAYPOINTS.removeIf(w -> w.name().equalsIgnoreCase(name));
        if (ok) save();
        return ok;
    }

    public static List<Waypoint> getAll() { return WAYPOINTS; }

    public static void save() {
        if (file == null) return;
        try { Files.writeString(file.toPath(), GSON.toJson(WAYPOINTS)); }
        catch (Exception e) { NovaClient.LOGGER.error("Échec de sauvegarde des waypoints", e); }
    }

    private static void load() {
        if (file == null || !file.isFile()) return;
        try {
            List<Waypoint> loaded = GSON.fromJson(Files.readString(file.toPath()),
                    new TypeToken<List<Waypoint>>() {}.getType());
            if (loaded != null) WAYPOINTS.addAll(loaded);
        } catch (Exception e) {
            NovaClient.LOGGER.error("Échec de chargement des waypoints", e);
        }
    }
}

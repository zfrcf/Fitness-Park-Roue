package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.waypoint.WaypointManager;

/**
 * Waypoints : affiche les waypoints enregistrés.
 * Le rendu 3D custom ayant changé en 26.2, les waypoints sont gérés
 * via les commandes .wp add/del/list et exposés ici pour le HUD.
 */
public class Waypoints extends Module {
    public Waypoints() { super("Waypoints", "Affiche les waypoints", Category.RENDER); }

    /** Nombre de waypoints actifs (pour le HUD). */
    public int getCount() { return WaypointManager.getAll().size(); }
}

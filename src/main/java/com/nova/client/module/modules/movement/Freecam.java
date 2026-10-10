package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;
import net.minecraft.world.phys.Vec3;

/**
 * Freecam : vol libre. NOTE : cette implémentation déplace le joueur
 * (le serveur voit le mouvement). Un vrai freecam à caméra détachée
 * nécessite un mixin du pipeline caméra (instable en 26.2).
 */
public class Freecam extends Module {
    private final DoubleSetting speed = addSetting(new DoubleSetting("Speed", "Vitesse", 1.0, 0.1, 5.0));

    private Vec3 startPos;
    private boolean oldFlying, oldMayFly, oldNoPhysics;

    public Freecam() { super("Freecam", "Vol libre (déplace le joueur)"); }

    @Override
    protected void onEnable() {
        if (mc.player == null) return;
        startPos = mc.player.position();
        var ab = mc.player.getAbilities();
        oldMayFly = ab.mayfly; oldFlying = ab.flying;
        oldNoPhysics = mc.player.noPhysics;
        ab.mayfly = true; ab.flying = true;
        mc.player.noPhysics = true;
    }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null) return;
        var ab = mc.player.getAbilities();
        ab.setFlyingSpeed((float) (0.05 * speed.get()));
        mc.player.resetFallDistance();
    }

    @Override
    protected void onDisable() {
        if (mc.player == null) return;
        var ab = mc.player.getAbilities();
        ab.mayfly = oldMayFly; ab.flying = oldFlying;
        ab.setFlyingSpeed(0.05f);
        mc.player.noPhysics = oldNoPhysics;
        if (startPos != null) mc.player.setPos(startPos.x, startPos.y, startPos.z);
        mc.player.setDeltaMovement(Vec3.ZERO);
    }
}

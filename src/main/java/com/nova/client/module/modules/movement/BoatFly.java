package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;
import net.minecraft.world.phys.Vec3;

/** BoatFly : permet de voler avec un bateau (détection par nom de classe). */
public class BoatFly extends Module {
    private final DoubleSetting speed = addSetting(new DoubleSetting("Speed", "Vitesse verticale", 0.3, 0.05, 2.0));

    public BoatFly() { super("BoatFly", "Voler avec un bateau", Category.MOVEMENT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null) return;
        var vehicle = mc.player.getVehicle();
        if (vehicle == null || !vehicle.getClass().getSimpleName().startsWith("Boat")) return;
        Vec3 vel = vehicle.getDeltaMovement();
        double my = vel.y;
        if (mc.options.keyJump.isDown()) my = speed.get();
        else if (mc.options.keyShift.isDown()) my = -speed.get();
        else my = 0;
        vehicle.setDeltaMovement(vel.x, my, vel.z);
        vehicle.resetFallDistance();
    }
}

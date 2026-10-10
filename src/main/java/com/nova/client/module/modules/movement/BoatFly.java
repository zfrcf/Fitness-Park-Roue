package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.phys.Vec3;

/** BoatFly : permet de voler avec un bateau. */
public class BoatFly extends Module {
    private final DoubleSetting speed = addSetting(new DoubleSetting("Speed", "Vitesse verticale", 0.3, 0.05, 2.0));

    public BoatFly() { super("BoatFly", "Voler avec un bateau"); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null) return;
        if (!(mc.player.getVehicle() instanceof Boat boat)) return;
        Vec3 vel = boat.getDeltaMovement();
        double my = vel.y;
        if (mc.options.keyJump.isDown()) my = speed.get();
        else if (mc.options.keyShift.isDown()) my = -speed.get();
        else my = 0;
        boat.setDeltaMovement(vel.x, my, vel.z);
        boat.resetFallDistance();
    }
}

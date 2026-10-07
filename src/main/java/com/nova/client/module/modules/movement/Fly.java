package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;
import com.nova.client.settings.ModeSetting;
import net.minecraft.world.phys.Vec3;

/** Fly vanilla/jetpack : mouvements plausibles, pas de téléportation. */
public class Fly extends Module {
    public enum Mode { VANILLA, JETPACK }

    private final ModeSetting<Mode> mode = addSetting(new ModeSetting<>("Mode", "Type de vol", Mode.VANILLA, Mode.class));
    private final DoubleSetting speed = addSetting(new DoubleSetting("Speed", "Vitesse", 1.0, 0.1, 5.0));

    public Fly() { super("Fly", "Vol créatif-like", Category.MOVEMENT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null) return;
        var input = mc.player.input;
        Vec3 vel = mc.player.getDeltaMovement();
        double s = speed.get() * 0.2;

        double mx = 0, mz = 0;
        float yaw = (float) Math.toRadians(mc.player.getYRot());
        if (input.hasForwardImpulse()) { mx -= Math.sin(yaw); mz += Math.cos(yaw); }
        if (input.keyPresses.left() || input.keyPresses.right()) {
            float side = input.keyPresses.left() ? 1f : -1f;
            mx -= Math.sin(yaw + Math.PI / 2) * side; mz += Math.cos(yaw + Math.PI / 2) * side;
        }

        double my = mode.get() == Mode.JETPACK && mc.options.keyJump.isDown() ? 0.25
                : mc.options.keyJump.isDown() ? s
                : mc.options.keyShift.isDown() ? -s : 0;

        double len = Math.hypot(mx, mz);
        if (len > 0) { mx = mx / len * s; mz = mz / len * s; }
        mc.player.setDeltaMovement(mx, my, mz);
        mc.player.resetFallDistance();
    }

    @Override
    protected void onDisable() {
        if (mc.player != null) mc.player.setDeltaMovement(Vec3.ZERO);
    }
}

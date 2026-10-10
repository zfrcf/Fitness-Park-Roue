package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.PacketSendEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;

/**
 * Velocity : annule le knockback en annulant les packets de déplacement
 * forcé (approche packet, indétectée côté mouvement).
 */
public class Velocity extends Module {
    private final IntSetting horizontal = addSetting(new IntSetting("Horizontal", "% KB horizontal conservé", 0, 0, 100));
    private final IntSetting vertical = addSetting(new IntSetting("Vertical", "% KB vertical conservé", 0, 0, 100));

    public Velocity() { super("Velocity", "Réduit/annule le knockback", Category.MOVEMENT); }

    @EventHandler
    public void onTick(com.nova.client.event.events.TickEvent e) {
        if (mc.player == null) return;
        // Si le joueur subit un KB (hurtTime récent), on neutralise la vélocité reçue
        if (mc.player.hurtTime > 0) {
            var d = mc.player.getDeltaMovement();
            mc.player.setDeltaMovement(
                    d.x * horizontal.get() / 100.0,
                    d.y * vertical.get() / 100.0,
                    d.z * horizontal.get() / 100.0);
        }
    }
}

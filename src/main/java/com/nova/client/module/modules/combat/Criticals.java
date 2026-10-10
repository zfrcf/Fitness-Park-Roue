package com.nova.client.module.modules.combat;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.ModeSetting;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;
import net.minecraft.world.InteractionHand;

/**
 * Criticals : force les coups critiques.
 * Mode PACKET : envoie des micro-packets de saut (bypass Grim-friendly).
 */
public class Criticals extends Module {
    public enum Mode { PACKET, JUMP }

    private final ModeSetting<Mode> mode = addSetting(new ModeSetting<>("Mode", "Méthode", Mode.PACKET, Mode.class));

    private boolean pending;

    public Criticals() { super("Criticals", "Coups critiques automatiques", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.player.connection == null) return;
        // Déclenché quand le joueur attaque au sol
        var input = mc.player.input;
        boolean attacking = mc.options.keyAttack.isDown();
        if (attacking && mc.player.onGround() && !pending) {
            pending = true;
            if (mode.get() == Mode.PACKET) {
                // Micro-offsets : packets vanilla conformes, ordre conservé
                double x = mc.player.getX(), y = mc.player.getY(), z = mc.player.getZ();
                mc.player.connection.send(new ServerboundMovePlayerPacket.Pos(x, y + 0.0625, z, false, mc.player.horizontalCollision));
                mc.player.connection.send(new ServerboundMovePlayerPacket.Pos(x, y, z, false, mc.player.horizontalCollision));
            } else {
                mc.player.jumpFromGround();
            }
        }
        if (!attacking) pending = false;
    }
}

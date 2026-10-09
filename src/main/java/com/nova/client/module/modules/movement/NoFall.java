package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.PacketSendEvent;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.ModeSetting;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;

/** NoFall : spoof onGround avant l'envoi (mode Packet) — aucun dégât de chute. */
public class NoFall extends Module {
    public enum Mode { PACKET, ONGROUND }

    private final ModeSetting<Mode> mode = addSetting(new ModeSetting<>("Mode", "Méthode", Mode.PACKET, Mode.class));

    public NoFall() { super("NoFall", "Annule les dégâts de chute", Category.MOVEMENT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mode.get() != Mode.ONGROUND) return;
        if (mc.player.fallDistance > 2.5f) mc.player.setOnGround(true);
    }

    @EventHandler
    public void onPacket(PacketSendEvent e) {
        if (mc.player == null || mode.get() != Mode.PACKET) return;
        if (e.getPacket() instanceof ServerboundMovePlayerPacket pkt && mc.player.fallDistance > 2.5f) {
            // Remplace par un packet onGround=true (ordre vanilla conservé)
            e.cancel();
            mc.player.connection.send(new ServerboundMovePlayerPacket.StatusOnly(true, mc.player.horizontalCollision));
        }
    }
}

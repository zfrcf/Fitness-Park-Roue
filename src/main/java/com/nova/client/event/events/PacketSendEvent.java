package com.nova.client.event.events;

import com.nova.client.event.CancellableEvent;
import net.minecraft.network.protocol.Packet;

/** Émis avant l'envoi d'un packet serveur ; annuler = le packet n'est jamais envoyé. */
public class PacketSendEvent extends CancellableEvent {
    private final Packet<?> packet;

    public PacketSendEvent(Packet<?> packet) { this.packet = packet; }
    public Packet<?> getPacket() { return packet; }
}

package com.nova.client.module.modules.world;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;

/**
 * Timer : multiplie la vitesse du jeu côté client.
 * Appliqué via le champ tickRateManager si disponible ; sinon sans effet
 * (mode sûr, ne désynchronise jamais le joueur volontairement).
 */
public class TimerModule extends Module {
    private final DoubleSetting speed = addSetting(new DoubleSetting("Speed", "Multiplicateur", 1.5, 0.1, 10.0));

    public TimerModule() { super("Timer", "Accélère le temps de jeu client", Category.WORLD); }

    public float getMultiplier() { return isEnabled() ? speed.get().floatValue() : 1f; }
}

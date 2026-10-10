package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/** EntityESP : réglages de l'ESP entités (glow géré par le module Esp). */
public class EntityEsp extends Module {
    private final BoolSetting hostiles = addSetting(new BoolSetting("Hostiles", "Monstres", true));
    private final BoolSetting passives = addSetting(new BoolSetting("Passives", "Animaux", false));

    public EntityEsp() { super("EntityESP", "ESP des entités (glow)", Category.RENDER); }

    public boolean hostiles() { return hostiles.get(); }
    public boolean passives() { return passives.get(); }
}

package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/** PlayerESP : réglages de l'ESP joueurs (glow géré par le module Esp). */
public class PlayerEsp extends Module {
    private final BoolSetting ignoreFriends = addSetting(new BoolSetting("IgnoreFriends", "Ignorer les amis", true));
    private final BoolSetting showInvisible = addSetting(new BoolSetting("ShowInvisible", "Voir les invisibles", true));

    public PlayerEsp() { super("PlayerESP", "ESP des joueurs (glow)", Category.RENDER); }

    public boolean ignoreFriends() { return ignoreFriends.get(); }
    public boolean showInvisible() { return showInvisible.get(); }
}

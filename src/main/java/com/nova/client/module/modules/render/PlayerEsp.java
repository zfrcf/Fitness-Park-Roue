package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.render.EspManager;
import com.nova.client.settings.BoolSetting;
import net.minecraft.world.entity.Entity;

import java.util.function.Predicate;

/** PlayerESP : fait briller les joueurs (modifiable : amis, invisibles). */
public class PlayerEsp extends Module {
    private final BoolSetting ignoreFriends = addSetting(new BoolSetting("IgnoreFriends", "Ignorer les amis", true));
    private final BoolSetting showInvisible = addSetting(new BoolSetting("ShowInvisible", "Voir les invisibles", true));

    private final Predicate<Entity> rule = e -> {
        if (!EspManager.isPlayer(e) || e == mc.player) return false;
        if (!showInvisible.get() && e.isInvisible()) return false;
        if (ignoreFriends.get() && e instanceof net.minecraft.world.entity.player.Player p
                && com.nova.client.NovaClient.friends().isFriend(p.getGameProfile().name())) return false;
        return true;
    };

    public PlayerEsp() { super("PlayerESP", "ESP des joueurs (glow)"); }

    @Override protected void onEnable() { EspManager.addRule(rule); }
    @Override protected void onDisable() { EspManager.removeRule(rule); }
}

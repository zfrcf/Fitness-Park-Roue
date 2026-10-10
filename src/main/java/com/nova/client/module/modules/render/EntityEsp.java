package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.render.EspManager;
import com.nova.client.settings.BoolSetting;
import net.minecraft.world.entity.Entity;

import java.util.function.Predicate;

/** EntityESP : fait briller les entités (modifiable : hostiles, passives). */
public class EntityEsp extends Module {
    private final BoolSetting hostiles = addSetting(new BoolSetting("Hostiles", "Monstres", true));
    private final BoolSetting passives = addSetting(new BoolSetting("Passives", "Animaux", false));

    private final Predicate<Entity> rule = e -> {
        if (e == mc.player || EspManager.isPlayer(e)) return false;
        if (EspManager.isHostile(e)) return hostiles.get();
        if (e instanceof net.minecraft.world.entity.animal.Animal) return passives.get();
        return false;
    };

    public EntityEsp() { super("EntityESP", "ESP des entités (glow)"); }

    @Override protected void onEnable() { EspManager.addRule(rule); }
    @Override protected void onDisable() { EspManager.removeRule(rule); }
}

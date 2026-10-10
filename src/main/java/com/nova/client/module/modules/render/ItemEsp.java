package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.render.EspManager;
import net.minecraft.world.entity.Entity;

import java.util.function.Predicate;

/** ItemESP : fait briller les objets au sol. */
public class ItemEsp extends Module {
    private final Predicate<Entity> rule = EspManager::isItem;

    public ItemEsp() { super("ItemESP", "ESP des objets au sol (glow)"); }

    @Override protected void onEnable() { EspManager.addRule(rule); }
    @Override protected void onDisable() { EspManager.removeRule(rule); }
}

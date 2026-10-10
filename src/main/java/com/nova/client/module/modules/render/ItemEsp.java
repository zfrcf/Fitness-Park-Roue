package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/**
 * ItemESP : fait briller les objets au sol via le glow vanilla.
 * NOTE : le glow est appliqué par le module Esp principal ; ce module
 * expose le réglage et sert de marqueur de catégorie.
 */
public class ItemEsp extends Module {
    private final BoolSetting glow = addSetting(new BoolSetting("Glow", "Faire briller les objets", true));

    public ItemEsp() { super("ItemESP", "ESP des objets au sol (glow)", Category.RENDER); }

    public boolean shouldGlow() { return isEnabled() && glow.get(); }
}

package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;

/** Zoom : réduit le FOV tant que le module est actif. */
public class Zoom extends Module {
    private final IntSetting fov = addSetting(new IntSetting("FOV", "Champ de vision", 20, 5, 60));
    private int oldFov = -1;

    public Zoom() { super("Zoom", "Zoom (FOV réduit)", Category.RENDER); }

    @Override
    protected void onEnable() {
        if (mc.options.fov() != null) {
            oldFov = mc.options.fov().get();
            mc.options.fov().set(fov.get());
        }
    }

    @Override
    protected void onDisable() {
        if (mc.options.fov() != null && oldFov >= 0) mc.options.fov().set(oldFov);
    }
}

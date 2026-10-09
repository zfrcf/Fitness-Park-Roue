package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** Fullbright : gamma forcé au maximum tant que le module est actif. */
public class Fullbright extends Module {
    private double oldGamma = -1;

    public Fullbright() { super("Fullbright", "Luminosité maximale partout", Category.RENDER); }

    @Override
    protected void onEnable() {
        if (mc.options.gamma() != null) {
            oldGamma = mc.options.gamma().get();
            mc.options.gamma().set(10.0);
        }
    }

    @Override
    protected void onDisable() {
        if (mc.options.gamma() != null && oldGamma >= 0) mc.options.gamma().set(oldGamma);
    }
}

package com.nova.client.module.modules.render;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/** NoRender : supprime certains éléments visuels (météo, etc.). */
public class NoRender extends Module {
    private final BoolSetting weather = addSetting(new BoolSetting("Weather", "Cacher la météo", true));
    private final BoolSetting fog = addSetting(new BoolSetting("Fog", "Réduire le brouillard", false));

    public NoRender() { super("NoRender", "Désactive des effets visuels"); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.level == null) return;
        if (weather.get()) {
            mc.level.setRainLevel(0f);
            mc.level.setThunderLevel(0f);
        }
    }

    public boolean hideFog() { return isEnabled() && fog.get(); }
}

package com.nova.client.module;

import com.nova.client.NovaClient;
import com.nova.client.settings.KeybindSetting;
import com.nova.client.settings.Setting;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Classe de base d'un module : settings, bind, cycle de vie onEnable/onDisable. */
public abstract class Module {
    protected static final Minecraft mc = Minecraft.getInstance();

    private final String name;
    private final String description;
    private final Category category;
    private final List<Setting<?>> settings = new ArrayList<>();
    private final KeybindSetting bind;
    private boolean enabled;
    private boolean wasKeyDown;

    protected Module(String name, String description, Category category) {
        this.name = name;
        this.description = description;
        this.category = category;
        this.bind = new KeybindSetting("Bind", "Touche d'activation", -1);
    }

    /** À surcharger : enregistrement des settings via addSetting(). */
    protected void registerSettings() {}

    protected <T extends Setting<?>> T addSetting(T s) { settings.add(s); return s; }

    public final void toggle() { setEnabled(!enabled); }

    public void setEnabled(boolean state) {
        if (this.enabled == state) return;
        this.enabled = state;
        if (state) {
            NovaClient.events().subscribe(this);
            onEnable();
        } else {
            NovaClient.events().unsubscribe(this);
            onDisable();
        }
    }

    protected void onEnable() {}
    protected void onDisable() {}

    /** Gestion du bind : appelée chaque tick par ModuleManager. */
    public final void handleBind(long window) {
        if (!bind.isBound()) return;
        boolean down = org.lwjgl.glfw.GLFW.glfwGetKey(window, bind.get()) == org.lwjgl.glfw.GLFW.GLFW_PRESS;
        switch (bind.getMode()) {
            case TOGGLE -> { if (down && !wasKeyDown) toggle(); }
            case HOLD -> { if (down != enabled) setEnabled(down); }
        }
        wasKeyDown = down;
    }

    public String getName() { return name; }
    public String getDescription() { return description; }
    public Category getCategory() { return category; }
    public boolean isEnabled() { return enabled; }
    public KeybindSetting getBind() { return bind; }
    public List<Setting<?>> getSettings() { return Collections.unmodifiableList(settings); }
}

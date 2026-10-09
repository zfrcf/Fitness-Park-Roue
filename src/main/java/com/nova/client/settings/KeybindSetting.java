package com.nova.client.settings;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.lwjgl.glfw.GLFW;

/** Keybind avec modes Toggle / Hold. -1 = aucun bind. */
public class KeybindSetting extends Setting<Integer> {
    public enum BindMode { TOGGLE, HOLD }

    private BindMode mode = BindMode.TOGGLE;

    public KeybindSetting(String name, String desc, int defKey) { super(name, desc, defKey); }

    public BindMode getMode() { return mode; }
    public void setMode(BindMode m) { this.mode = m; }
    public boolean isBound() { return get() != GLFW.GLFW_KEY_UNKNOWN && get() != -1; }

    @Override public JsonElement toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("key", get());
        o.addProperty("mode", mode.name());
        return o;
    }
    @Override public void fromJson(JsonElement el) {
        JsonObject o = el.getAsJsonObject();
        set(o.get("key").getAsInt());
        mode = BindMode.valueOf(o.get("mode").getAsString());
    }
}

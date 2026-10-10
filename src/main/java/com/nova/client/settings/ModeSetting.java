package com.nova.client.settings;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public class ModeSetting<E extends Enum<E>> extends Setting<E> {
    private final Class<E> type;
    public ModeSetting(String name, String desc, E def, Class<E> type) {
        super(name, desc, def);
        this.type = type;
    }
    public E[] getModes() { return type.getEnumConstants(); }
    public void cycle() {
        E[] modes = getModes();
        set(modes[(get().ordinal() + 1) % modes.length]);
    }
    @Override public JsonElement toJson() { return new JsonPrimitive(get().name()); }
    @Override public void fromJson(JsonElement el) { set(Enum.valueOf(type, el.getAsString())); }
}

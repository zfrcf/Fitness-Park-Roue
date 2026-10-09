package com.nova.client.settings;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public class IntSetting extends Setting<Integer> {
    private final int min, max;
    public IntSetting(String name, String desc, int def, int min, int max) {
        super(name, desc, def);
        this.min = min; this.max = max;
    }
    @Override public void set(Integer v) { super.set(Math.max(min, Math.min(max, v))); }
    public int getMin() { return min; }
    public int getMax() { return max; }
    @Override public JsonElement toJson() { return new JsonPrimitive(get()); }
    @Override public void fromJson(JsonElement el) { set(el.getAsInt()); }
}

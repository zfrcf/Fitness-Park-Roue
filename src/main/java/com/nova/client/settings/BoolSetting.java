package com.nova.client.settings;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public class BoolSetting extends Setting<Boolean> {
    public BoolSetting(String name, String desc, boolean def) { super(name, desc, def); }
    public void toggle() { set(!get()); }
    @Override public JsonElement toJson() { return new JsonPrimitive(get()); }
    @Override public void fromJson(JsonElement el) { set(el.getAsBoolean()); }
}

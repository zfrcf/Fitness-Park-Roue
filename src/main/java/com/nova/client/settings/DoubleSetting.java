package com.nova.client.settings;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public class DoubleSetting extends Setting<Double> {
    private final double min, max;
    public DoubleSetting(String name, String desc, double def, double min, double max) {
        super(name, desc, def);
        this.min = min; this.max = max;
    }
    @Override public void set(Double v) { super.set(Math.max(min, Math.min(max, v))); }
    public double getMin() { return min; }
    public double getMax() { return max; }
    @Override public JsonElement toJson() { return new JsonPrimitive(get()); }
    @Override public void fromJson(JsonElement el) { set(el.getAsDouble()); }
}

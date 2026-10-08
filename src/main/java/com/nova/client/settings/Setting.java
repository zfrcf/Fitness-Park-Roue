package com.nova.client.settings;

import com.google.gson.JsonElement;
import java.util.function.Supplier;

/** Base générique d'un réglage sérialisable, avec visibilité conditionnelle. */
public abstract class Setting<T> {
    private final String name;
    private final String description;
    protected T value;
    private final T defaultValue;
    private Supplier<Boolean> visibleIf = () -> true;
    private Runnable changeListener;

    protected Setting(String name, String description, T defaultValue) {
        this.name = name;
        this.description = description;
        this.defaultValue = defaultValue;
        this.value = defaultValue;
    }

    public String getName() { return name; }
    public String getDescription() { return description; }
    public T get() { return value; }
    public T getDefault() { return defaultValue; }

    public void set(T v) {
        this.value = v;
        if (changeListener != null) changeListener.run();
    }

    public boolean isVisible() { return visibleIf.get(); }
    public Setting<T> visibleIf(Supplier<Boolean> cond) { this.visibleIf = cond; return this; }
    public Setting<T> onChange(Runnable r) { this.changeListener = r; return this; }

    public abstract JsonElement toJson();
    public abstract void fromJson(JsonElement el);
}

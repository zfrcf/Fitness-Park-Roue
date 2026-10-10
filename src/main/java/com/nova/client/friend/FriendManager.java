package com.nova.client.friend;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.nova.client.NovaClient;

import java.io.File;
import java.nio.file.Files;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Liste d'amis persistée en JSON (utilisée par KillAura, etc.). */
public class FriendManager {
    private static final Gson GSON = new Gson();
    private final File file;
    private final Set<String> friends = new LinkedHashSet<>();

    public FriendManager(File dir) {
        this.file = new File(dir, "friends.json");
        load();
    }

    public boolean add(String name) {
        boolean ok = friends.add(name.toLowerCase(Locale.ROOT));
        if (ok) save();
        return ok;
    }

    public boolean remove(String name) {
        boolean ok = friends.remove(name.toLowerCase(Locale.ROOT));
        if (ok) save();
        return ok;
    }

    public boolean isFriend(String name) {
        return name != null && friends.contains(name.toLowerCase(Locale.ROOT));
    }

    public Set<String> getAll() { return Collections.unmodifiableSet(friends); }

    private void load() {
        if (!file.isFile()) return;
        try {
            Set<String> loaded = GSON.fromJson(Files.readString(file.toPath()),
                    new TypeToken<Set<String>>() {}.getType());
            if (loaded != null) friends.addAll(loaded);
        } catch (Exception e) {
            NovaClient.LOGGER.error("Échec de chargement des amis", e);
        }
    }

    public void save() {
        try {
            Files.writeString(file.toPath(), GSON.toJson(friends));
        } catch (Exception e) {
            NovaClient.LOGGER.error("Échec de sauvegarde des amis", e);
        }
    }
}

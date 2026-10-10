package com.nova.client.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.nova.client.NovaClient;
import com.nova.client.module.Module;
import com.nova.client.settings.Setting;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

/**
 * Sauvegarde JSON (Gson) dans .minecraft/nova/.
 * Profils multiples : save(name)/load(name). Profil courant : "default".
 */
public class ConfigManager {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final File dir;
    private String profile = "default";

    public ConfigManager(File dir) {
        this.dir = dir;
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    public File getDir() { return dir; }
    public String getProfile() { return profile; }

    /** Valide le nom de profil : empêche toute écriture hors du dossier de config. */
    private File fileFor(String name) {
        if (!name.matches("[a-zA-Z0-9_-]{1,32}")) {
            NovaClient.LOGGER.warn("Nom de profil invalide '{}', fallback sur 'default'", name);
            name = "default";
        }
        return new File(dir, name + ".json");
    }

    public void save() { save(profile); }

    public void save(String name) {
        JsonObject root = new JsonObject();
        for (Module m : NovaClient.modules().getModules()) {
            JsonObject mo = new JsonObject();
            mo.addProperty("enabled", m.isEnabled());
            mo.add("bind", m.getBind().toJson());
            JsonObject so = new JsonObject();
            for (Setting<?> s : m.getSettings()) so.add(s.getName(), s.toJson());
            mo.add("settings", so);
            root.add(m.getName(), mo);
        }
        try {
            Files.writeString(fileFor(name).toPath(), GSON.toJson(root));
        } catch (IOException e) {
            NovaClient.LOGGER.error("Échec de sauvegarde du profil {}", name, e);
        }
    }

    public void load() { load(profile); }

    public void load(String name) {
        this.profile = name;
        File f = fileFor(name);
        if (!f.isFile()) return;
        try {
            JsonObject root = GSON.fromJson(Files.readString(f.toPath()), JsonObject.class);
            // Désactive d'abord tout : évite l'état incohérent entre deux profils
            NovaClient.modules().disableAll();
            for (Module m : NovaClient.modules().getModules()) {
                if (!root.has(m.getName())) continue;
                JsonObject mo = root.getAsJsonObject(m.getName());
                if (mo.has("bind")) m.getBind().fromJson(mo.get("bind"));
                if (mo.has("settings")) {
                    JsonObject so = mo.getAsJsonObject("settings");
                    for (Setting<?> s : m.getSettings()) {
                        if (so.has(s.getName())) {
                            try { s.fromJson(so.get(s.getName())); }
                            catch (Exception ignored) { /* setting renommé/supprimé : on garde le défaut */ }
                        }
                    }
                }
                // setEnabled en dernier : les settings doivent être chargés avant onEnable
                if (mo.has("enabled") && mo.get("enabled").getAsBoolean()) m.setEnabled(true);
            }
        } catch (Exception e) {
            NovaClient.LOGGER.error("Échec de chargement du profil {}", name, e);
        }
    }
}

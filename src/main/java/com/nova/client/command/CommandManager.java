package com.nova.client.command;

import com.nova.client.NovaClient;
import com.nova.client.module.Module;
import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Commandes chat avec préfixe "." : .help, .toggle, .bind, .friend, .prefix.
 * Intercepte les messages sortants commençant par le préfixe.
 */
public class CommandManager {
    private String prefix = ".";

    public void register() {
        ClientSendMessageEvents.ALLOW_CHAT.register(this::onChat);
    }

    public String getPrefix() { return prefix; }

    private boolean onChat(String message) {
        if (!message.startsWith(prefix)) return true;
        String[] args = message.substring(prefix.length()).split(" ");
        String cmd = args[0].toLowerCase(Locale.ROOT);
        switch (cmd) {
            case "help" -> help();
            case "toggle", "t" -> {
                if (args.length < 2) { msg("Usage: " + prefix + "toggle <module>"); break; }
                Module m = NovaClient.modules().getByName(args[1]);
                if (m == null) msg("Module introuvable : " + args[1]);
                else { m.toggle(); msg(m.getName() + (m.isEnabled() ? " §aactivé" : " §cdésactivé")); }
            }
            case "bind" -> {
                if (args.length < 3) { msg("Usage: " + prefix + "bind <module> <keyGLFW|-1>"); break; }
                Module m = NovaClient.modules().getByName(args[1]);
                if (m == null) { msg("Module introuvable."); break; }
                try {
                    m.getBind().set(Integer.parseInt(args[2]));
                    msg("Bind de " + m.getName() + " -> " + args[2]);
                } catch (NumberFormatException e) { msg("Touche invalide (code GLFW)."); }
            }
            case "friend" -> friend(args);
            case "prefix" -> {
                if (args.length < 2) { msg("Usage: " + prefix + "prefix <char>"); break; }
                prefix = args[1];
                msg(Component.translatable("novaclient.command.prefix_changed", prefix).getString());
            }
            case "addons" -> {
                msg("Addons chargés :");
                NovaClient.addons().getAddons().forEach(a -> msg(" §b" + a.getName() + " §7v" + a.getVersion()));
                NovaClient.addons().getFailed().forEach(f -> msg(" §c" + f));
            }
            default -> msg("Commande inconnue. " + prefix + "help pour la liste.");
        }
        return false; // le message n'est jamais envoyé au serveur
    }

    private void help() {
        msg("§d--- NovaClient ---");
        msg(prefix + "toggle <module> §7- active/désactive");
        msg(prefix + "bind <module> <key> §7- assigne une touche");
        msg(prefix + "friend add/remove/list §7- amis");
        msg(prefix + "prefix <char> §7- change le préfixe");
        msg(prefix + "addons §7- liste les addons");
        msg("Modules : " + NovaClient.modules().getModules().size());
    }

    private void friend(String[] args) {
        if (args.length < 2) { msg("Usage: friend add/remove/list <nom>"); return; }
        switch (args[1].toLowerCase(Locale.ROOT)) {
            case "add" -> { if (args.length > 2 && NovaClient.friends().add(args[2])) msg("§aAmi ajouté : " + args[2]); else msg("§cDéjà ami ou nom manquant."); }
            case "remove" -> { if (args.length > 2 && NovaClient.friends().remove(args[2])) msg("§cAmi retiré : " + args[2]); else msg("§cIntrouvable."); }
            case "list" -> {
                List<String> list = new ArrayList<>(NovaClient.friends().getAll());
                msg(list.isEmpty() ? "Aucun ami." : "Amis : §b" + String.join(", ", list));
            }
            default -> msg("Usage: friend add/remove/list <nom>");
        }
    }

    private void msg(String s) {
        var mc = Minecraft.getInstance();
        if (mc.player != null) mc.player.sendMessage(Component.literal("§5[Nova]§r " + s), false);
    }
}

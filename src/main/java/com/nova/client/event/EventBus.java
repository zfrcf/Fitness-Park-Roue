package com.nova.client.event;

import java.lang.reflect.Method;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * EventBus par réflexion : toute méthode publique à un paramètre annotée
 * {@link EventHandler} est abonnée. Dispatch trié par priorité HIGHEST -> LOWEST.
 */
public class EventBus {
    private record Handler(Object owner, Method method, EventHandler.Priority priority) {}

    private final Map<Class<? extends Event>, List<Handler>> handlers = new ConcurrentHashMap<>();

    public void subscribe(Object listener) {
        for (Method m : listener.getClass().getDeclaredMethods()) {
            EventHandler ann = m.getAnnotation(EventHandler.class);
            if (ann == null || m.getParameterCount() != 1) continue;
            Class<?> type = m.getParameterTypes()[0];
            if (!Event.class.isAssignableFrom(type)) continue;
            m.setAccessible(true);
            handlers.computeIfAbsent(type.asSubclass(Event.class), k -> new CopyOnWriteArrayList<>())
                    .add(new Handler(listener, m, ann.priority()));
            handlers.get(type).sort(Comparator.comparingInt(h -> h.priority().ordinal()));
        }
    }

    public void unsubscribe(Object listener) {
        handlers.values().forEach(list -> list.removeIf(h -> h.owner() == listener));
    }

    /** Poste l'événement. Renvoie l'événement (chaînable, permet de tester isCancelled). */
    public <T extends Event> T post(T event) {
        List<Handler> list = handlers.get(event.getClass());
        if (list == null) return event;
        for (Handler h : list) {
            try {
                h.method().invoke(h.owner(), event);
            } catch (Exception e) {
                // Isolation : un handler qui plante ne casse pas le dispatch
                com.nova.client.NovaClient.LOGGER.error("Erreur dans un handler d'événement", e);
            }
        }
        return event;
    }
}

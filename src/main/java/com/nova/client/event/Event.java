package com.nova.client.event;

/** Classe de base de tous les événements. */
public abstract class Event {
    private boolean cancelled;

    public boolean isCancelled() { return cancelled; }
    /** Annule l'événement. Sans effet si l'événement n'est pas cancellable par design. */
    public void cancel() { this.cancelled = true; }
}

package de.decode.bluemapplayermodels;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.logging.LogUtils;
import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft_6455;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class PlayerWebSocketServer extends WebSocketServer implements AutoCloseable {
    static final String PATH = "/bluemap-player-models/ws";
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final String ADDRESS_PROPERTY = "bluemap-player-models.websocket-address";
    private static final String PORT_PROPERTY = "bluemap-player-models.websocket-port";
    private static final int DEFAULT_PORT = 8101;
    private static final int MAX_FRAME_BYTES = 2048;

    private final Map<WebSocket, String> subscriptions = new ConcurrentHashMap<>();

    PlayerWebSocketServer() {
        super(
            configuredAddress(),
            1,
            List.of(new Draft_6455(List.of(), MAX_FRAME_BYTES))
        );
        setConnectionLostTimeout(30);
        setReuseAddr(true);
    }

    @Override
    public void onOpen(WebSocket connection, ClientHandshake handshake) {
        if (!PATH.equals(handshake.getResourceDescriptor()) || !isSameOrigin(handshake)) {
            connection.close(1008, "Unsupported request");
        }
    }

    @Override
    public void onMessage(WebSocket connection, String message) {
        try {
            if (message.length() > 512) {
                throw new IllegalArgumentException("Subscription is too large");
            }
            JsonObject payload = JsonParser.parseString(message).getAsJsonObject();
            String mapId = payload.get("mapId").getAsString();
            if (mapId.isBlank() || mapId.length() > 256 || mapId.chars().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("Invalid map id");
            }
            subscriptions.put(connection, mapId);
        } catch (RuntimeException exception) {
            connection.close(1008, "Invalid subscription");
        }
    }

    @Override
    public void onMessage(WebSocket connection, ByteBuffer message) {
        connection.close(1003, "Text subscriptions only");
    }

    @Override
    public void onClose(WebSocket connection, int code, String reason, boolean remote) {
        subscriptions.remove(connection);
    }

    @Override
    public void onError(WebSocket connection, Exception exception) {
        if (connection == null) {
            LOGGER.warn("BETA WebSocket server failed", exception);
        } else {
            subscriptions.remove(connection);
            LOGGER.debug("BETA WebSocket client failed", exception);
        }
    }

    @Override
    public void onStart() {
        LOGGER.info("BETA WebSocket server listening on {}{}", getAddress(), PATH);
    }

    Set<String> subscribedMaps() {
        return Set.copyOf(subscriptions.values());
    }

    void broadcast(String mapId, String payload) {
        subscriptions.forEach((connection, subscription) -> {
            try {
                if (mapId.equals(subscription)
                    && connection.isOpen()
                    && !connection.hasBufferedData()) {
                    connection.send(payload);
                }
            } catch (RuntimeException exception) {
                subscriptions.remove(connection);
                connection.close();
            }
        });
    }

    @Override
    public void close() {
        subscriptions.clear();
        try {
            stop(1000);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private static InetSocketAddress configuredAddress() {
        int port = Integer.getInteger(PORT_PROPERTY, DEFAULT_PORT);
        if (port < 1 || port > 65535) {
            LOGGER.warn("Invalid {}={}, using {}", PORT_PROPERTY, port, DEFAULT_PORT);
            port = DEFAULT_PORT;
        }
        return new InetSocketAddress(System.getProperty(ADDRESS_PROPERTY, "127.0.0.1"), port);
    }

    private static boolean isSameOrigin(ClientHandshake handshake) {
        String origin = handshake.getFieldValue("Origin");
        String host = handshake.getFieldValue("Host");
        if (origin == null || host == null) {
            return false;
        }
        try {
            URI uri = URI.create(origin);
            return ("http".equalsIgnoreCase(uri.getScheme())
                || "https".equalsIgnoreCase(uri.getScheme()))
                && host.equalsIgnoreCase(uri.getRawAuthority());
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}

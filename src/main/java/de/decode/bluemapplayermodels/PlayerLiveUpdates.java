package de.decode.bluemapplayermodels;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

final class PlayerLiveUpdates implements AutoCloseable {
    static final String PATH = "bluemap-player-models/live";
    static final String SEQUENCE_HEADER = "X-BPM-Sequence";

    private static final String LOGGING_HANDLER =
        "de.bluecolored.bluemap.common.web.LoggingRequestHandler";
    private static final int MAX_WAITERS = 256;
    private static final int MAX_WAITERS_PER_SOURCE = 8;
    private static final long WAIT_MILLIS = 25_000;

    private final Map<String, Feed> feeds = new ConcurrentHashMap<>();
    private final Map<InetAddress, Integer> sourceWaiters = new ConcurrentHashMap<>();
    private final AtomicInteger waiterCount = new AtomicInteger();
    private final AtomicLong sequence = new AtomicLong(System.currentTimeMillis() * 1_000L);
    private final ResponseFactory responses;
    private final Set<String> mapIds;
    private final Object webServer;
    private final Object originalHandler;
    private final Method getRequestHandler;
    private final Method setRequestHandler;
    private Object installedHandler;
    private volatile boolean closed;

    private PlayerLiveUpdates(
        ResponseFactory responses,
        Set<String> mapIds,
        Object webServer,
        Object originalHandler,
        Method getRequestHandler,
        Method setRequestHandler
    ) {
        this.responses = responses;
        this.mapIds = Set.copyOf(mapIds);
        this.webServer = webServer;
        this.originalHandler = originalHandler;
        this.getRequestHandler = getRequestHandler;
        this.setRequestHandler = setRequestHandler;
    }

    static PlayerLiveUpdates install(Object api, Set<String> mapIds) {
        try {
            Object plugin = api.getClass().getMethod("plugin").invoke(api);
            Object routes = plugin == null
                ? null
                : plugin.getClass().getMethod("getWebRequestHandler").invoke(plugin);
            Object webServer = plugin == null
                ? null
                : plugin.getClass().getMethod("getWebServer").invoke(plugin);
            if (routes == null || webServer == null) {
                throw new IllegalStateException("BlueMap's built-in webserver is disabled");
            }

            Method getRequestHandler = webServer.getClass().getMethod("getRequestHandler");
            Object originalHandler = getRequestHandler.invoke(webServer);
            if (originalHandler == null
                || !LOGGING_HANDLER.equals(originalHandler.getClass().getName())
                || originalHandler.getClass().getMethod("getDelegate").invoke(originalHandler)
                    != routes) {
                throw new IllegalStateException("BlueMap 5.12's HTTP handler chain has changed");
            }

            Class<?> handlerType = getRequestHandler.getReturnType();
            Method setRequestHandler =
                webServer.getClass().getMethod("setRequestHandler", handlerType);
            Method handle = java.util.Arrays.stream(handlerType.getMethods())
                .filter(method -> method.getName().equals("handle")
                    && method.getParameterCount() == 1)
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("BlueMap HTTP handler is unavailable"));
            PlayerLiveUpdates updates = new PlayerLiveUpdates(
                new ResponseFactory(handle.getReturnType()),
                mapIds,
                webServer,
                originalHandler,
                getRequestHandler,
                setRequestHandler
            );
            Method getPath = handle.getParameterTypes()[0].getMethod("getPath");
            Object handler = Proxy.newProxyInstance(
                handlerType.getClassLoader(),
                new Class<?>[] {handlerType},
                (proxy, method, arguments) -> {
                    if (method.equals(handle)) {
                        String path = String.valueOf(getPath.invoke(arguments[0]));
                        if (("/" + PATH).equals(path)) {
                            return updates.handle(arguments[0]);
                        }
                        try {
                            return handle.invoke(originalHandler, arguments[0]);
                        } catch (InvocationTargetException exception) {
                            throw exception.getCause();
                        }
                    }
                    return proxyObjectMethod(proxy, method, arguments);
                }
            );
            Object reconnectHandler = Proxy.newProxyInstance(
                handlerType.getClassLoader(),
                new Class<?>[] {handlerType},
                (proxy, method, arguments) -> method.equals(handle)
                    ? updates.closedResponse()
                    : proxyObjectMethod(proxy, method, arguments)
            );
            routeRegister(routes).invoke(routes, Pattern.quote(PATH), reconnectHandler);
            updates.installedHandler = handler;
            setRequestHandler.invoke(webServer, handler);
            return updates;
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(
                "BlueMap 5.12's built-in HTTP router is unavailable",
                exception
            );
        }
    }

    private static Object proxyObjectMethod(Object proxy, Method method, Object[] arguments) {
        return switch (method.getName()) {
            case "toString" -> "BlueMap Player Models live handler";
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == arguments[0];
            default -> throw new UnsupportedOperationException(method.toString());
        };
    }

    private static Method routeRegister(Object routes) throws NoSuchMethodException {
        return java.util.Arrays.stream(routes.getClass().getMethods())
            .filter(method -> method.getName().equals("register")
                && method.getParameterCount() == 2
                && method.getParameterTypes()[0] == String.class
                && method.getParameterTypes()[1].isInterface())
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("BlueMap route registration is unavailable"));
    }

    Set<String> subscribedMaps() {
        return Set.copyOf(feeds.keySet());
    }

    void publish(String mapId, String payload) {
        Feed feed = feeds.get(mapId);
        if (feed != null) {
            feed.publish(new Snapshot(sequence.incrementAndGet(), payload));
        }
    }

    Object handle(Object request) {
        if (closed) {
            return closedResponse();
        }
        String mapId;
        long after;
        InetAddress source;
        try {
            mapId = requestValue(request, "getQueryParam", "mapId");
            after = Long.parseLong(requestValue(request, "getQueryParam", "after"));
            if (!"GET".equals(requestValue(request, "getMethod"))) {
                return responses.create("BAD_REQUEST", null);
            }
            Object sourceValue = request.getClass().getMethod("getSource").invoke(request);
            if (!(sourceValue instanceof InetAddress address)) {
                return responses.create("BAD_REQUEST", null);
            }
            source = address;
            if ("cross-site".equalsIgnoreCase(requestHeader(request, "Sec-Fetch-Site"))) {
                return responses.create("FORBIDDEN", null);
            }
        } catch (ReflectiveOperationException | NumberFormatException exception) {
            return responses.create("BAD_REQUEST", null);
        }
        if (mapId == null
            || mapId.isBlank()
            || mapId.length() > 256
            || mapId.chars().anyMatch(Character::isISOControl)
            || !mapIds.contains(mapId)
            || after < 0) {
            return responses.create("BAD_REQUEST", null);
        }
        if (!acquireSource(source)) {
            return busyResponse();
        }
        if (waiterCount.incrementAndGet() > MAX_WAITERS) {
            waiterCount.decrementAndGet();
            releaseSource(source);
            return busyResponse();
        }

        Feed feed = feeds.compute(mapId, (ignored, current) -> {
            Feed value = current == null ? new Feed() : current;
            value.waiters.incrementAndGet();
            return value;
        });
        if (closed) {
            feed.close();
        }
        try {
            Snapshot snapshot = feed.await(after);
            if (closed) {
                return closedResponse();
            }
            if (snapshot == null) {
                return responses.create("NO_CONTENT", null);
            }
            Object response = responses.create("OK", snapshot.payload);
            responses.addHeader(response, SEQUENCE_HEADER, Long.toString(snapshot.sequence));
            return response;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return closed ? closedResponse() : responses.create("SERVICE_UNAVAILABLE", null);
        } finally {
            waiterCount.decrementAndGet();
            releaseSource(source);
            feeds.computeIfPresent(mapId, (ignored, current) ->
                current == feed && current.waiters.decrementAndGet() == 0 ? null : current
            );
        }
    }

    @Override
    public void close() {
        closed = true;
        feeds.values().forEach(Feed::close);
        try {
            if (getRequestHandler.invoke(webServer) == installedHandler) {
                setRequestHandler.invoke(webServer, originalHandler);
            }
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("Could not restore BlueMap's HTTP handler", exception);
        }
    }

    private boolean acquireSource(InetAddress source) {
        boolean[] acquired = {false};
        sourceWaiters.compute(source, (ignored, count) -> {
            int current = count == null ? 0 : count;
            if (current >= MAX_WAITERS_PER_SOURCE) {
                return current;
            }
            acquired[0] = true;
            return current + 1;
        });
        return acquired[0];
    }

    private void releaseSource(InetAddress source) {
        sourceWaiters.computeIfPresent(source, (ignored, count) -> count == 1 ? null : count - 1);
    }

    private Object busyResponse() {
        Object response = responses.create("SERVICE_UNAVAILABLE", null);
        responses.addHeader(response, "Retry-After", "5");
        return response;
    }

    private Object closedResponse() {
        Object response = responses.create("SERVICE_UNAVAILABLE", null);
        responses.addHeader(response, "Connection", "close");
        return response;
    }

    private static String requestValue(Object request, String method, String... arguments)
        throws ReflectiveOperationException {
        Class<?>[] parameterTypes = new Class<?>[arguments.length];
        java.util.Arrays.fill(parameterTypes, String.class);
        Object value = request.getClass()
            .getMethod(method, parameterTypes)
            .invoke(request, (Object[]) arguments);
        return value == null ? null : value.toString();
    }

    private static String requestHeader(Object request, String name)
        throws ReflectiveOperationException {
        Object header = request.getClass()
            .getMethod("getHeader", String.class)
            .invoke(request, name);
        if (header == null) {
            return null;
        }
        Object values = header.getClass().getMethod("getValues").invoke(header);
        if (!(values instanceof List<?> list) || list.isEmpty()) {
            return null;
        }
        Object value = list.get(0);
        return value == null ? null : value.toString();
    }

    private static final class ResponseFactory {
        private final Constructor<?> constructor;
        private final Class<?> statusType;
        private final Method addHeader;
        private final Method setBody;

        private ResponseFactory(Class<?> responseType) throws NoSuchMethodException {
            constructor = java.util.Arrays.stream(responseType.getConstructors())
                .filter(value -> value.getParameterCount() == 1
                    && value.getParameterTypes()[0].isEnum())
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("BlueMap HTTP response is unavailable"));
            statusType = constructor.getParameterTypes()[0];
            addHeader = responseType.getMethod("addHeader", String.class, String[].class);
            setBody = responseType.getMethod("setBody", String.class);
        }

        private Object create(String status, String body) {
            try {
                Object statusValue = java.util.Arrays.stream(statusType.getEnumConstants())
                    .filter(value -> ((Enum<?>) value).name().equals(status))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Unknown HTTP status " + status));
                Object response = constructor.newInstance(statusValue);
                addHeader(response, "Cache-Control", "no-store");
                addHeader(response, "X-Content-Type-Options", "nosniff");
                if (body != null) {
                    addHeader(response, "Content-Type", "application/json; charset=utf-8");
                    setBody.invoke(response, body);
                }
                return response;
            } catch (ReflectiveOperationException exception) {
                throw new IllegalStateException("Could not create a BlueMap HTTP response", exception);
            }
        }

        private void addHeader(Object response, String name, String value) {
            try {
                addHeader.invoke(response, name, (Object) new String[] {value});
            } catch (ReflectiveOperationException exception) {
                throw new IllegalStateException("Could not create a BlueMap HTTP response", exception);
            }
        }
    }

    private static final class Feed {
        private final AtomicInteger waiters = new AtomicInteger();
        private Snapshot snapshot;
        private boolean closed;

        synchronized Snapshot await(long after) throws InterruptedException {
            long remaining = WAIT_MILLIS * 1_000_000;
            long deadline = System.nanoTime() + remaining;
            while (!closed
                && (snapshot == null || snapshot.sequence <= after)
                && remaining > 0) {
                wait(remaining / 1_000_000, (int) (remaining % 1_000_000));
                remaining = deadline - System.nanoTime();
            }
            return snapshot != null && snapshot.sequence > after ? snapshot : null;
        }

        synchronized void publish(Snapshot next) {
            if (closed) {
                return;
            }
            snapshot = next;
            notifyAll();
        }

        synchronized void close() {
            closed = true;
            notifyAll();
        }
    }

    private record Snapshot(long sequence, String payload) {}
}

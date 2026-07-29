package de.decode.bluemapplayermodels;

import java.net.InetAddress;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

public final class PlayerLiveUpdatesSelfTest {
    public static void main(String[] args) throws Exception {
        FakeRoutes routes = new FakeRoutes();
        FakeApi api = new FakeApi(routes);
        PlayerLiveUpdates updates = PlayerLiveUpdates.install(
            api,
            java.util.Set.of("world")
        );
        FakeHandler handler = api.plugin().getWebServer().getRequestHandler();
        var executor = Executors.newFixedThreadPool(8);
        try {
            var pending = executor.submit(() -> handler.handle(
                request("/bluemap-player-models/live", Map.of(
                    "mapId", "world",
                    "after", "0"
                ))
            ));
            await(
                () -> updates.subscribedMaps().contains("world"),
                "live request did not subscribe"
            );
            updates.publish("world", "{\"mapId\":\"world\",\"players\":[]}");
            FakeResponse response = pending.get(1, TimeUnit.SECONDS);

            require(response.status == FakeStatus.OK, "live request did not return 200");
            long sequence = Long.parseLong(
                response.headers.get(PlayerLiveUpdates.SEQUENCE_HEADER)
            );
            require(sequence > 0 && sequence <= 9_007_199_254_740_991L, "invalid sequence");
            require(response.body.contains("\"world\""), "live payload is missing");
            require(
                handler.handle(request(
                    "/bluemap-player-models/live",
                    Map.of("mapId", "unknown", "after", "0")
                )).status
                    == FakeStatus.BAD_REQUEST,
                "unknown map was accepted"
            );
            require(
                handler.handle(request("/", Map.of())).status == FakeStatus.BAD_REQUEST,
                "ordinary BlueMap request was not delegated"
            );
            require(
                handler.handle(new FakeRequest(
                    "GET",
                    "/bluemap-player-models/live",
                    Map.of("mapId", "world", "after", "0"),
                    InetAddress.getLoopbackAddress(),
                    Map.of("Sec-Fetch-Site", new FakeHeader(List.of("cross-site")))
                )).status == FakeStatus.FORBIDDEN,
                "cross-site live request was accepted"
            );
            FakeResponse reconnect = routes.liveHandler.handle(
                request("/bluemap-player-models/live", Map.of("mapId", "world", "after", "0"))
            );
            require(
                "close".equals(reconnect.headers.get("Connection")),
                "old BlueMap connection was not retired"
            );

            InetAddress sharedSource = InetAddress.getByName("192.0.2.1");
            var sourceWaitersField = PlayerLiveUpdates.class.getDeclaredField("sourceWaiters");
            sourceWaitersField.setAccessible(true);
            @SuppressWarnings("unchecked")
            Map<InetAddress, Integer> sourceWaiters =
                (Map<InetAddress, Integer>) sourceWaitersField.get(updates);
            for (int index = 0; index < 8; index++) {
                executor.submit(() -> handler.handle(new FakeRequest(
                    "GET",
                    "/bluemap-player-models/live",
                    Map.of("mapId", "world", "after", Long.toString(Long.MAX_VALUE)),
                    sharedSource,
                    Map.of()
                )));
            }
            await(
                () -> Integer.valueOf(8).equals(sourceWaiters.get(sharedSource)),
                "per-source waiters did not register"
            );
            FakeResponse busy = handler.handle(new FakeRequest(
                "GET",
                "/bluemap-player-models/live",
                Map.of("mapId", "world", "after", Long.toString(Long.MAX_VALUE)),
                sharedSource,
                Map.of()
            ));
            require(busy.status == FakeStatus.SERVICE_UNAVAILABLE, "source limit was bypassed");
            require("5".equals(busy.headers.get("Retry-After")), "source limit has no backoff");

            updates.close();
            FakeResponse closed = handler.handle(
                request("/bluemap-player-models/live", Map.of(
                    "mapId", "world",
                    "after", "0"
                ))
            );
            require(closed.status == FakeStatus.SERVICE_UNAVAILABLE, "closed route stayed active");
            require("close".equals(closed.headers.get("Connection")), "closed route kept connection");
            require(
                api.plugin().getWebServer().getRequestHandler()
                    instanceof de.bluecolored.bluemap.common.web.LoggingRequestHandler,
                "BlueMap handler was not restored"
            );
        } finally {
            updates.close();
            executor.shutdownNow();
        }
        System.out.println("same-port live-update self-check passed");
    }

    private static FakeRequest request(String path, Map<String, String> query) {
        return new FakeRequest(
            "GET",
            path,
            query,
            InetAddress.getLoopbackAddress(),
            Map.of()
        );
    }

    private static void await(BooleanSupplier condition, String message) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() >= deadline) {
                throw new AssertionError(message);
            }
            Thread.onSpinWait();
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static final class FakeApi {
        private final FakePlugin plugin;

        FakeApi(FakeRoutes routes) {
            plugin = new FakePlugin(
                routes,
                new FakeServer(
                    new de.bluecolored.bluemap.common.web.LoggingRequestHandler(routes)
                )
            );
        }

        public FakePlugin plugin() {
            return plugin;
        }
    }

    public record FakePlugin(FakeRoutes routes, FakeServer webServer) {
        public FakeRoutes getWebRequestHandler() {
            return routes;
        }

        public FakeServer getWebServer() {
            return webServer;
        }
    }

    public static final class FakeServer {
        private FakeHandler requestHandler;

        FakeServer(FakeHandler requestHandler) {
            this.requestHandler = requestHandler;
        }

        public FakeHandler getRequestHandler() {
            return requestHandler;
        }

        public void setRequestHandler(FakeHandler requestHandler) {
            this.requestHandler = requestHandler;
        }
    }

    public static final class FakeRoutes implements FakeHandler {
        private FakeHandler liveHandler;

        public void register(String path, FakeHandler value) {
            require(path.contains(PlayerLiveUpdates.PATH), "wrong live route");
            liveHandler = value;
        }

        @Override
        public FakeResponse handle(FakeRequest request) {
            return new FakeResponse(FakeStatus.BAD_REQUEST);
        }
    }

    public interface FakeHandler {
        FakeResponse handle(FakeRequest request);
    }

    public record FakeRequest(
        String method,
        String path,
        Map<String, String> query,
        InetAddress source,
        Map<String, FakeHeader> headers
    ) {
        public String getMethod() {
            return method;
        }

        public String getPath() {
            return path;
        }

        public String getQueryParam(String name) {
            return query.get(name);
        }

        public InetAddress getSource() {
            return source;
        }

        public FakeHeader getHeader(String name) {
            return headers.get(name);
        }
    }

    public record FakeHeader(List<String> values) {
        public List<String> getValues() {
            return values;
        }
    }

    public enum FakeStatus {
        OK,
        NO_CONTENT,
        BAD_REQUEST,
        FORBIDDEN,
        SERVICE_UNAVAILABLE
    }

    public static final class FakeResponse {
        private final FakeStatus status;
        private final Map<String, String> headers = new HashMap<>();
        private String body;

        public FakeResponse(FakeStatus status) {
            this.status = status;
        }

        public void addHeader(String name, String... values) {
            headers.put(name, String.join(",", values));
        }

        public void setBody(String body) {
            this.body = body;
        }
    }
}

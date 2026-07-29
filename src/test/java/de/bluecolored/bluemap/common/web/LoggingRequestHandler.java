package de.bluecolored.bluemap.common.web;

import de.decode.bluemapplayermodels.PlayerLiveUpdatesSelfTest.FakeHandler;
import de.decode.bluemapplayermodels.PlayerLiveUpdatesSelfTest.FakeRequest;
import de.decode.bluemapplayermodels.PlayerLiveUpdatesSelfTest.FakeResponse;

public final class LoggingRequestHandler implements FakeHandler {
    private final FakeHandler delegate;

    public LoggingRequestHandler(FakeHandler delegate) {
        this.delegate = delegate;
    }

    public FakeHandler getDelegate() {
        return delegate;
    }

    @Override
    public FakeResponse handle(FakeRequest request) {
        return delegate.handle(request);
    }
}

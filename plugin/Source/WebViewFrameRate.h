#pragma once

/**
 * macOS only. Finds the WKWebView living under the given NSView (the plugin
 * editor's peer) and disables WebKit's private `PreferPageRenderingUpdatesNear60FPSEnabled`
 * feature, which otherwise throttles requestAnimationFrame to 60fps regardless of
 * the display refresh rate. Returns true once the feature was found and toggled.
 *
 * Uses private WebKit API. There is no public alternative (Apple FB16411517 is
 * unresolved). Acceptable for a non-App-Store FOSS plugin; guarded by
 * respondsToSelector so it degrades to a no-op if the private API changes.
 */
bool prismUncapWebViewFrameRate(void* nsViewHandle);

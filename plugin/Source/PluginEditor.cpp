#include "PluginEditor.h"
#include <cstring>

#if ! PRISM_USE_DEV_SERVER
 #include "BinaryData.h"
#endif

#if JUCE_MAC
 #include "WebViewFrameRate.h"
#endif

namespace
{
    const juce::Identifier kSpectrumFrameEvent { "spectrumFrame" };
    constexpr int kDrainCapacity = 16384;

#if PRISM_USE_DEV_SERVER
    // Hot-reload path: load the Vite dev server (run `npm run plugin-ui:dev`).
    const juce::String kDevServerUrl { "http://localhost:5174" };
#else
    // Self-contained path: serve the bundle embedded via juce_add_binary_data.
    juce::String mimeForExtension(const juce::String& name)
    {
        if (name.endsWithIgnoreCase(".html"))  return "text/html";
        if (name.endsWithIgnoreCase(".js"))    return "text/javascript";
        if (name.endsWithIgnoreCase(".css"))   return "text/css";
        if (name.endsWithIgnoreCase(".svg"))   return "image/svg+xml";
        if (name.endsWithIgnoreCase(".json"))  return "application/json";
        if (name.endsWithIgnoreCase(".woff2")) return "font/woff2";
        if (name.endsWithIgnoreCase(".woff"))  return "font/woff";
        if (name.endsWithIgnoreCase(".png"))   return "image/png";
        return "application/octet-stream";
    }

    std::optional<juce::WebBrowserComponent::Resource> provideResource(const juce::String& url)
    {
        // "/" -> index.html; otherwise match the request's basename against the
        // embedded originals (juce_add_binary_data stores files by basename).
        auto name = (url == "/") ? juce::String("index.html")
                                 : url.fromLastOccurrenceOf("/", false, false);
        name = name.upToFirstOccurrenceOf("?", false, false);

        for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
        {
            if (name == juce::String(BinaryData::originalFilenames[i]))
            {
                int dataSize = 0;
                const char* data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], dataSize);
                std::vector<std::byte> bytes ((size_t) dataSize);
                std::memcpy (bytes.data(), data, (size_t) dataSize);
                return juce::WebBrowserComponent::Resource { std::move (bytes), mimeForExtension (name) };
            }
        }
        return std::nullopt;
    }
#endif

    juce::WebBrowserComponent::Options makeWebOptions()
    {
        auto options = juce::WebBrowserComponent::Options{}.withNativeIntegrationEnabled();
#if ! PRISM_USE_DEV_SERVER
        options = options.withResourceProvider ([] (const auto& url) { return provideResource (url); });
#endif
        return options;
    }
}

PrismSpectrumEditor::PrismSpectrumEditor(PrismSpectrumProcessor& p)
    : juce::AudioProcessorEditor(&p),
      processorRef(p),
      webView(makeWebOptions())
{
    drainScratch.assign((size_t) kDrainCapacity, 0.0f);

    addAndMakeVisible(webView);

#if PRISM_USE_DEV_SERVER
    webView.goToURL(kDevServerUrl);
#else
    webView.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
#endif

    setResizable(true, true);
    setResizeLimits(360, 200, 4096, 4096);
    setSize(900, 480);

    // Drive frames at the display's refresh rate (adapts to 60/120/144 Hz).
    vblank = juce::VBlankAttachment(this, [this] { renderFrame(); });
}

void PrismSpectrumEditor::resized()
{
    webView.setBounds(getLocalBounds());
}

void PrismSpectrumEditor::renderFrame()
{
#if JUCE_MAC
    // Once the editor is on screen, lift WKWebView's private 60fps cap so the
    // canvas repaints at the display's native rate (e.g. 120Hz). Retry a few
    // frames until the web view exists in the hierarchy, then stop.
    if (! frameRateUncapped && uncapAttempts < 300)
    {
        ++uncapAttempts;
        if (auto* peer = getPeer())
            frameRateUncapped = prismUncapWebViewFrameRate(peer->getNativeHandle());
    }
#endif

    const double sampleRate = processorRef.getSampleRateHz();
    if (sampleRate > 0.0 && sampleRate != lastSampleRate)
    {
        spectrum.setSampleRate((float) sampleRate);
        lastSampleRate = sampleRate;
    }

    const int drained = processorRef.drainSamples(drainScratch.data(), (int) drainScratch.size());
    if (drained > 0)
        spectrum.pushSamples(drainScratch.data(), (size_t) drained);
    else
        spectrum.pushSamples(nullptr, 0); // recompute so smoothing keeps decaying to silence

    const auto& magnitudes = spectrum.getMagnitudes();
    if (magnitudes.empty())
        return;

    const auto encoded = juce::Base64::toBase64(magnitudes.data(),
                                                magnitudes.size() * sizeof(float));

    auto* payload = new juce::DynamicObject();
    payload->setProperty("sampleRate", sampleRate);
    payload->setProperty("magnitudes", encoded);

    webView.emitEventIfBrowserIsVisible(kSpectrumFrameEvent, juce::var(payload));
}

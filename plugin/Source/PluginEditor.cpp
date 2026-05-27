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
    const juce::Identifier kRestoreSettingsEvent { "prismRestoreSettings" };
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

    juce::WebBrowserComponent::Options makeWebOptions(PrismSpectrumEditor& editor)
    {
        auto options = juce::WebBrowserComponent::Options{}
            .withNativeIntegrationEnabled()
            .withEventListener("prismConfig", [&editor](juce::var v) { editor.onPrismConfig(std::move(v)); })
            .withEventListener("prismReady",  [&editor](juce::var)   { editor.onPrismReady(); });
#if ! PRISM_USE_DEV_SERVER
        options = options.withResourceProvider([](const auto& url) { return provideResource(url); });
#endif
        return options;
    }

    juce::String floatBufferToBase64(const std::vector<float>& data)
    {
        if (data.empty())
            return {};
        return juce::Base64::toBase64(data.data(), data.size() * sizeof(float));
    }
}

PrismSpectrumEditor::PrismSpectrumEditor(PrismSpectrumProcessor& p)
    : juce::AudioProcessorEditor(&p),
      processorRef(p),
      webView(makeWebOptions(*this))
{
    drainLeft.assign((size_t) kDrainCapacity, 0.0f);
    drainRight.assign((size_t) kDrainCapacity, 0.0f);

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

void PrismSpectrumEditor::onPrismConfig(juce::var payload)
{
    // Persist only genuine per-instance overrides (persist=true). App-default /
    // restore-driven updates carry persist=false so a non-overridden instance
    // keeps re-reading the app's current settings on reopen.
    if ((bool) payload.getProperty("persist", false))
        processorRef.setSettingsJson(payload.getProperty("json", juce::var(juce::String())).toString());

    // Apply the DSP-relevant settings to the (message-thread-owned) analyzer.
    const int fftSize = (int) payload.getProperty("fftSize", 2048);
    if (fftSize > 0 && (size_t) fftSize != spectrum.getFFTSize())
        spectrum.setFFTSize((size_t) fftSize);

    spectrum.setSmoothing((float) (double) payload.getProperty("smoothing", 0.9));
}

void PrismSpectrumEditor::onPrismReady()
{
    pushRestoreSettings();
    sendAppDefaults();
}

void PrismSpectrumEditor::sendAppDefaults()
{
    // macOS userApplicationDataDirectory is ~/Library, so append "Application Support".
    const auto appData = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                             .getChildFile("Application Support")
                             .getChildFile("prism");
    const auto docs = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
    const auto themesDir = docs.getChildFile("Prism Themes");
    const auto profilesDir = docs.getChildFile("Prism Profiles");

    juce::String themeId, themeFile, profileJson;

    // Active theme id -> its .iro file (the app loads the file, so it matches exactly).
    if (const auto themeState = juce::JSON::parse(appData.getChildFile("theme-state.json"));
        auto* obj = themeState.getDynamicObject())
        themeId = obj->getProperty("activeThemeId").toString();

    if (themeId.isNotEmpty())
    {
        const auto file = themesDir.getChildFile(themeId + ".iro");
        if (file.existsAsFile())
            themeFile = file.loadFileAsString();
    }

    // Active profile id -> the .prsm whose inner "id" matches (filenames are by name).
    juce::String activeProfileId;
    if (const auto profileState = juce::JSON::parse(appData.getChildFile("profile-state.json"));
        auto* obj = profileState.getDynamicObject())
        activeProfileId = obj->getProperty("activeProfileId").toString();

    if (activeProfileId.isNotEmpty() && profilesDir.isDirectory())
    {
        for (const auto& file : profilesDir.findChildFiles(juce::File::findFiles, false, "*.prsm"))
        {
            const auto content = file.loadFileAsString();
            if (const auto parsed = juce::JSON::parse(content); auto* o = parsed.getDynamicObject())
            {
                if (o->getProperty("id").toString() == activeProfileId)
                {
                    profileJson = content;
                    break;
                }
            }
        }
    }

    auto* payload = new juce::DynamicObject();
    payload->setProperty("themeId", themeId);
    payload->setProperty("themeFile", themeFile);
    payload->setProperty("profileJson", profileJson);
    webView.emitEventIfBrowserIsVisible(juce::Identifier("prismAppDefaults"), juce::var(payload));
}

void PrismSpectrumEditor::pushRestoreSettings()
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("json", processorRef.getSettingsJson());
    webView.emitEventIfBrowserIsVisible(kRestoreSettingsEvent, juce::var(obj));
}

void PrismSpectrumEditor::renderFrame()
{
#if JUCE_MAC
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

    const int drained = processorRef.drainStereo(drainLeft.data(), drainRight.data(), (int) drainLeft.size());
    if (drained > 0)
        spectrum.pushStereoSamples(drainLeft.data(), drainRight.data(), (size_t) drained);
    else
        spectrum.pushStereoSamples(nullptr, nullptr, 0); // recompute so smoothing keeps decaying

    const auto& mid = spectrum.getMagnitudes();
    if (mid.empty())
        return;

    auto* payload = new juce::DynamicObject();
    payload->setProperty("sampleRate", sampleRate);
    payload->setProperty("magnitudes", floatBufferToBase64(mid));
    payload->setProperty("side", floatBufferToBase64(spectrum.getSideMagnitudes()));

    webView.emitEventIfBrowserIsVisible(kSpectrumFrameEvent, juce::var(payload));
}

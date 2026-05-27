#include "PluginEditor.h"
#include "SpectrumEngine.h"
#include "OscilloscopeEngine.h"
#include "VUMeterEngine.h"
#include <cstring>

#if ! PRISM_USE_DEV_SERVER
 #include "BinaryData.h"
#endif

#if JUCE_MAC
 #include "WebViewFrameRate.h"
#endif

namespace
{
    const juce::Identifier kRestoreSettingsEvent { "prismRestoreSettings" };
    constexpr int kDrainCapacity = 16384;

    std::unique_ptr<ScopeEngine> makeEngine()
    {
#if defined(PRISM_SCOPE_VUMETER) && PRISM_SCOPE_VUMETER
        return std::make_unique<VUMeterEngine>();
#elif defined(PRISM_SCOPE_OSCILLOSCOPE) && PRISM_SCOPE_OSCILLOSCOPE
        return std::make_unique<OscilloscopeEngine>();
#else
        return std::make_unique<SpectrumEngine>();
#endif
    }

#if PRISM_USE_DEV_SERVER
    const juce::String kDevServerUrl { "http://localhost:5174" };
#else
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

    juce::WebBrowserComponent::Options makeWebOptions(PrismSpectrumEditor& editor, const char* scopeId)
    {
        auto options = juce::WebBrowserComponent::Options{}
            .withNativeIntegrationEnabled()
            .withInitialisationData("prismScope", juce::String(scopeId))
            .withEventListener("prismConfig", [&editor](juce::var v) { editor.onPrismConfig(std::move(v)); })
            .withEventListener("prismReady",  [&editor](juce::var)   { editor.onPrismReady(); });
#if ! PRISM_USE_DEV_SERVER
        options = options.withResourceProvider([](const auto& url) { return provideResource(url); });
#endif
        return options;
    }
}

PrismSpectrumEditor::PrismSpectrumEditor(PrismSpectrumProcessor& p)
    : juce::AudioProcessorEditor(&p),
      processorRef(p),
      engine(makeEngine()),
      webView(makeWebOptions(*this, engine->scopeId()))
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
    const auto settings = payload.getProperty("settings", juce::var());

    // Persist only genuine per-instance overrides (persist=true). App-default /
    // restore-driven updates carry persist=false so a non-overridden instance
    // keeps re-reading the app's current settings on reopen.
    if ((bool) payload.getProperty("persist", false))
        processorRef.setSettingsJson(juce::JSON::toString(settings));

    engine->configure(settings);
}

void PrismSpectrumEditor::onPrismReady()
{
    pushRestoreSettings();
    sendAppDefaults();
}

void PrismSpectrumEditor::pushRestoreSettings()
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("json", processorRef.getSettingsJson());
    webView.emitEventIfBrowserIsVisible(kRestoreSettingsEvent, juce::var(obj));
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

    if (const auto themeState = juce::JSON::parse(appData.getChildFile("theme-state.json"));
        auto* obj = themeState.getDynamicObject())
        themeId = obj->getProperty("activeThemeId").toString();

    if (themeId.isNotEmpty())
    {
        const auto file = themesDir.getChildFile(themeId + ".iro");
        if (file.existsAsFile())
            themeFile = file.loadFileAsString();
    }

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
        engine->setSampleRate(sampleRate);
        lastSampleRate = sampleRate;
    }

    const int drained = processorRef.drainStereo(drainLeft.data(), drainRight.data(), (int) drainLeft.size());
    engine->process(drainLeft.data(), drainRight.data(), drained);

    webView.emitEventIfBrowserIsVisible(engine->frameEventId(), engine->buildFrame(sampleRate));
}

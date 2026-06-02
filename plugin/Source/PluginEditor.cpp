#include "PluginEditor.h"
#include "SpectrumEngine.h"
#include "OscilloscopeEngine.h"
#include "VUMeterEngine.h"
#include "LUFSMeterEngine.h"
#include "VectorscopeEngine.h"
#include "SpectrogramEngine.h"
#include "WaveformEngine.h"
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
#if defined(PRISM_SCOPE_WAVEFORM) && PRISM_SCOPE_WAVEFORM
        return std::make_unique<WaveformEngine>();
#elif defined(PRISM_SCOPE_SPECTROGRAM) && PRISM_SCOPE_SPECTROGRAM
        return std::make_unique<SpectrogramEngine>();
#elif defined(PRISM_SCOPE_VECTORSCOPE) && PRISM_SCOPE_VECTORSCOPE
        return std::make_unique<VectorscopeEngine>();
#elif defined(PRISM_SCOPE_LUFSMETER) && PRISM_SCOPE_LUFSMETER
        return std::make_unique<LUFSMeterEngine>();
#elif defined(PRISM_SCOPE_VUMETER) && PRISM_SCOPE_VUMETER
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
            .withEventListener("prismReady",  [&editor](juce::var)   { editor.onPrismReady(); })
            .withEventListener("prismSpectrogramConfig", [&editor](juce::var v) { editor.onScopeNativeConfig(std::move(v)); })
            .withEventListener("prismSettingsPanel", [&editor](juce::var v) { editor.onSettingsPanel(std::move(v)); });

#if JUCE_WINDOWS
        options = options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2);

        // WebView2's default user-data folder is created next to the host executable.
        // For plugins installed under Program Files\Common Files\VST3\..., that path
        // is read-only to the (non-admin) DAW process; WebView2 may fail to
        // initialise, leaving a blank webview or canceled navigation page.
        // Point it at a writable per-user folder instead (JUCE's docs flag this
        // explicitly for plugin projects).
        const auto webView2DataDir =
            juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                .getChildFile("prism")
                .getChildFile("WebView2");
        webView2DataDir.createDirectory();
        options = options.withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}.withUserDataFolder(webView2DataDir));
#endif

#if ! PRISM_USE_DEV_SERVER
        options = options.withResourceProvider([](const auto& url) { return provideResource(url); });
#endif
        return options;
    }
}

PrismSpectrumEditor::PrismSpectrumEditor(PrismSpectrumProcessor& p)
    : juce::AudioProcessorEditor(&p),
      processorRef(p),
      engine(makeEngine())
{
    drainLeft.assign((size_t) kDrainCapacity, 0.0f);
    drainRight.assign((size_t) kDrainCapacity, 0.0f);

    loadWebView();

    // Per-scope sizing: open at the scope's preferred default, with a per-scope min.
    const auto pref = engine->preferredSize();
    setResizable(true, true);
    setResizeLimits(pref.minWidth, pref.minHeight, 4096, 4096);
    setSize(pref.defaultWidth, pref.defaultHeight);

    // Drive frames at the display's refresh rate (adapts to 60/120/144 Hz).
    if (webView != nullptr)
        vblank = juce::VBlankAttachment(this, [this] { renderFrame(); });
}

void PrismSpectrumEditor::resized()
{
    if (webView != nullptr)
        webView->setBounds(getLocalBounds());

    webViewFallback.setBounds(getLocalBounds());
}

void PrismSpectrumEditor::loadWebView()
{
    auto options = makeWebOptions(*this, engine->scopeId());

#if JUCE_WINDOWS
    if (! juce::WebBrowserComponent::areOptionsSupported(options))
    {
        showWebViewFallback();
        return;
    }
#endif

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*webView);

#if PRISM_USE_DEV_SERVER
    webView->goToURL(kDevServerUrl);
#else
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
#endif
}

void PrismSpectrumEditor::showWebViewFallback()
{
    webViewFallback.setText(
        "Prism needs the Microsoft Edge WebView2 Runtime to show this plugin on Windows.\n"
        "Install the Evergreen WebView2 Runtime from Microsoft, then reopen the plugin.",
        juce::dontSendNotification);
    webViewFallback.setJustificationType(juce::Justification::centred);
    webViewFallback.setColour(juce::Label::backgroundColourId, juce::Colour(0xff111216));
    webViewFallback.setColour(juce::Label::textColourId, juce::Colour(0xfff4f6f8));
    webViewFallback.setMinimumHorizontalScale(0.75f);
    addAndMakeVisible(webViewFallback);
}

void PrismSpectrumEditor::onSettingsPanel(juce::var payload)
{
    const int height = juce::jmax(0, (int) payload.getProperty("height", 0));
    const int delta = height - settingsPanelHeight;
    if (delta == 0)
        return;

    settingsPanelHeight = height;
    // Grow/shrink the window by exactly the panel height so the scope area is
    // unchanged. Deliberately NOT touching resize limits — doing so makes JUCE's
    // constrainer snap the window and double the applied size.
    setSize(getWidth(), getHeight() + delta);
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

void PrismSpectrumEditor::onScopeNativeConfig(juce::var payload)
{
    engine->configureNative(payload);
}

void PrismSpectrumEditor::pushRestoreSettings()
{
    if (webView == nullptr)
        return;

    auto* obj = new juce::DynamicObject();
    obj->setProperty("json", processorRef.getSettingsJson());
    webView->emitEventIfBrowserIsVisible(kRestoreSettingsEvent, juce::var(obj));
}

void PrismSpectrumEditor::sendAppDefaults()
{
    if (webView == nullptr)
        return;

    // Resolve Prism's app-data dir to match Electron's userData per platform.
    // macOS: userApplicationDataDirectory == ~/Library, so the Electron path is
    //   ~/Library/Application Support/prism (the extra subfolder only exists on mac).
    // Windows/Linux: JUCE's userApplicationDataDirectory already points at the right
    //   per-platform config root (%APPDATA% / ~/.config), so no extra append needed.
   #if JUCE_MAC
    const auto appData = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                             .getChildFile("Application Support")
                             .getChildFile("prism");
   #else
    const auto appData = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                             .getChildFile("prism");
   #endif
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
    webView->emitEventIfBrowserIsVisible(juce::Identifier("prismAppDefaults"), juce::var(payload));
}

void PrismSpectrumEditor::renderFrame()
{
    if (webView == nullptr)
        return;

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

    webView->emitEventIfBrowserIsVisible(engine->frameEventId(), engine->buildFrame(sampleRate));
}

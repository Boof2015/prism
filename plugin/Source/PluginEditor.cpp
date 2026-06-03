#include "PluginEditor.h"
#include "SpectrumEngine.h"
#include "OscilloscopeEngine.h"
#include "VUMeterEngine.h"
#include "LUFSMeterEngine.h"
#include "VectorscopeEngine.h"
#include "SpectrogramEngine.h"
#include "WaveformEngine.h"
#include <cmath>
#include <cstdlib>
#include <cstring>

#ifndef PRISM_EMBED_WEBUI
 #define PRISM_EMBED_WEBUI 0
#endif

#ifndef PRISM_LINUX_UI_MODE_NAME
 #define PRISM_LINUX_UI_MODE_NAME "webview"
#endif

#if PRISM_EMBED_WEBUI
 #include "BinaryData.h"
#endif

#if JUCE_MAC
 #include "WebViewFrameRate.h"
#endif

namespace
{
    const juce::Identifier kRestoreSettingsEvent { "prismRestoreSettings" };
    constexpr int kDrainCapacity = 1 << 16;
#if JUCE_WINDOWS
    constexpr int kFallbackWindowsFrameRateHz = 60;
    constexpr int kMaxWindowsFrameRateHz = 240;

    int resolveWindowsFrameRateHz(const juce::Component& component)
    {
        const auto& displays = juce::Desktop::getInstance().getDisplays();
        if (const auto* display = displays.getDisplayForRect(component.getScreenBounds()))
        {
            const auto frequency = display->verticalFrequencyHz;
            if (frequency.has_value() && std::isfinite(*frequency) && *frequency > 0.0)
                return juce::jlimit(30, kMaxWindowsFrameRateHz, (int) std::lround(*frequency));
        }

        return kFallbackWindowsFrameRateHz;
    }
#endif

#if JUCE_LINUX
    constexpr int kLinuxFrameRateHz = 20;

    juce::String envValue(const char* name)
    {
        if (const auto* value = std::getenv(name); value != nullptr && value[0] != '\0')
            return value;

        return "<unset>";
    }

    juce::File linuxDiagnosticLogFile()
    {
        juce::File baseDir;

        if (const auto* xdgState = std::getenv("XDG_STATE_HOME"); xdgState != nullptr && xdgState[0] != '\0')
            baseDir = juce::File(juce::String(xdgState));
        else if (const auto* home = std::getenv("HOME"); home != nullptr && home[0] != '\0')
            baseDir = juce::File(juce::String(home)).getChildFile(".local").getChildFile("state");
        else
            baseDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);

        return baseDir.getChildFile("prism").getChildFile("plugin-ui-diagnostics.log");
    }

    void logLinuxDiagnostic(const juce::String& message)
    {
        const auto file = linuxDiagnosticLogFile();
        file.getParentDirectory().createDirectory();
        file.appendText(juce::Time::getCurrentTime().toISO8601(true) + " " + message + "\n",
                        false,
                        false,
                        "\n");
    }

    juce::String wrapperTypeName()
    {
        switch (juce::PluginHostType::getPluginLoadedAs())
        {
            case juce::AudioProcessor::wrapperType_VST3:       return "VST3";
            case juce::AudioProcessor::wrapperType_VST:        return "VST2";
            case juce::AudioProcessor::wrapperType_Standalone: return "Standalone";
            case juce::AudioProcessor::wrapperType_AudioUnit:  return "AudioUnit";
            case juce::AudioProcessor::wrapperType_AudioUnitv3:return "AudioUnitv3";
            case juce::AudioProcessor::wrapperType_AAX:        return "AAX";
            case juce::AudioProcessor::wrapperType_LV2:        return "LV2";
            case juce::AudioProcessor::wrapperType_Unity:      return "Unity";
            default:                                           return "Undefined";
        }
    }

    juce::String linuxHostDisplayContext()
    {
        const juce::PluginHostType host;
        juce::String context;
        context << "mode=" << PRISM_LINUX_UI_MODE_NAME
                << " host=\"" << host.getHostDescription() << "\""
                << " wrapper=" << wrapperTypeName()
                << " display=" << envValue("DISPLAY")
                << " waylandDisplay=" << envValue("WAYLAND_DISPLAY")
                << " sessionType=" << envValue("XDG_SESSION_TYPE")
                << " gdkBackend=" << envValue("GDK_BACKEND")
                << " desktop=" << envValue("XDG_CURRENT_DESKTOP");
        return context;
    }

    juce::String describeBounds(const juce::Rectangle<int>& bounds)
    {
        juce::String text;
        text << bounds.getX() << "," << bounds.getY()
             << " " << bounds.getWidth() << "x" << bounds.getHeight();
        return text;
    }
#endif

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
#elif PRISM_EMBED_WEBUI
    const char* getWebResourceData(const juce::String& name, int& dataSize)
    {
        dataSize = 0;

        for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
        {
            if (name == juce::String(BinaryData::originalFilenames[i]))
                return BinaryData::getNamedResource(BinaryData::namedResourceList[i], dataSize);
        }

        return nullptr;
    }

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

        int dataSize = 0;
        if (const char* data = getWebResourceData(name, dataSize))
        {
            std::vector<std::byte> bytes ((size_t) dataSize);
            std::memcpy (bytes.data(), data, (size_t) dataSize);
            return juce::WebBrowserComponent::Resource { std::move (bytes), mimeForExtension (name) };
        }

        return std::nullopt;
    }

    juce::String getResourceProviderOrigin()
    {
        return juce::WebBrowserComponent::getResourceProviderRoot().trimCharactersAtEnd("/");
    }

#if JUCE_LINUX
    juce::File writeLinuxWebViewIndexFile()
    {
        int dataSize = 0;
        const char* data = getWebResourceData("index.html", dataSize);

        if (data == nullptr || dataSize <= 0)
            return {};

        const auto webViewDir =
            juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                .getChildFile("prism")
                .getChildFile("plugin-webview");

        if (! webViewDir.createDirectory())
            return {};

        auto indexFile = webViewDir.getChildFile("index.html");

        if (! indexFile.replaceWithData(data, (size_t) dataSize))
            return {};

        return indexFile;
    }
#endif
#endif

#if JUCE_LINUX
    juce::String makeWebSmokeUrl()
    {
        const juce::String html =
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<style>html,body{width:100%;height:100%;margin:0;background:#000;color:rgba(255,255,255,.82);"
            "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}body{display:grid;place-items:center;}"
            "#status{padding:20px;text-align:center;white-space:pre-wrap;}</style></head>"
            "<body><div id=\"status\">Prism WebView smoke test\\nWaiting for JUCE bridge...</div>"
            "<script>"
            "function ready(){var s=document.getElementById('status');"
            "try{if(window.__JUCE__&&window.__JUCE__.backend){window.__JUCE__.backend.emitEvent('prismReady',{});"
            "if(s)s.textContent='Prism WebView smoke test\\nJUCE bridge emitted prismReady';return;}}"
            "catch(e){if(s)s.textContent='Prism WebView smoke test\\n'+String(e&&e.message||e);return;}"
            "setTimeout(ready,50);}ready();"
            "</script></body></html>";

        return "data:text/html;charset=utf-8," + juce::URL::addEscapeChars(html, false);
    }

    class FloatingWebViewWindow final : public juce::DocumentWindow
    {
    public:
        FloatingWebViewWindow()
            : juce::DocumentWindow("Prism WebView diagnostic",
                                   juce::Colours::black,
                                   juce::DocumentWindow::closeButton)
        {
            setUsingNativeTitleBar(true);
            setResizable(true, true);
        }

        void closeButtonPressed() override
        {
            logLinuxDiagnostic("floating_webview closeButtonPressed");
            setVisible(false);
        }
    };
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

#if PRISM_EMBED_WEBUI
        options = options.withResourceProvider(
            [](const auto& url) { return provideResource(url); },
            getResourceProviderOrigin());
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

#if JUCE_LINUX
    logLinuxDiagnostic("editor constructed scope=" + juce::String(engine->scopeId())
                       + " " + linuxHostDisplayContext()
                       + " logFile=" + linuxDiagnosticLogFile().getFullPathName());
#endif

    loadUi();

    // Per-scope sizing: open at the scope's preferred default, with a per-scope min.
    const auto pref = engine->preferredSize();
    setResizable(true, true);
    setResizeLimits(pref.minWidth, pref.minHeight, 4096, 4096);
    setSize(pref.defaultWidth, pref.defaultHeight);
}

PrismSpectrumEditor::~PrismSpectrumEditor()
{
#if JUCE_WINDOWS || JUCE_LINUX
    stopTimer();
#endif
#if JUCE_LINUX
    logLinuxDiagnostic("editor destructed scope=" + juce::String(engine->scopeId())
                       + " mode=" + juce::String(PRISM_LINUX_UI_MODE_NAME));
    floatingWebViewWindow.reset();
#endif
    webViewReady = false;
}

void PrismSpectrumEditor::resized()
{
    if (webView != nullptr && webView->getParentComponent() == this)
        webView->setBounds(getLocalBounds());

    webViewFallback.setBounds(getLocalBounds());

#if JUCE_LINUX
    logLinuxDiagnostic("editor resized local=" + describeBounds(getLocalBounds())
                       + " screen=" + describeBounds(getScreenBounds())
                       + " mode=" + juce::String(PRISM_LINUX_UI_MODE_NAME));
#endif
}

void PrismSpectrumEditor::loadUi()
{
#if JUCE_LINUX
    logLinuxDiagnostic("loadUi " + linuxHostDisplayContext());

   #if defined(PRISM_LINUX_UI_MODE_NATIVE_SMOKE) && PRISM_LINUX_UI_MODE_NATIVE_SMOKE
    loadNativeSmoke();
    return;
   #elif defined(PRISM_LINUX_UI_MODE_WEB_SMOKE) && PRISM_LINUX_UI_MODE_WEB_SMOKE
    loadWebSmoke();
    return;
   #elif defined(PRISM_LINUX_UI_MODE_FLOATING_WEBVIEW) && PRISM_LINUX_UI_MODE_FLOATING_WEBVIEW
    loadFloatingWebView();
    return;
   #endif
#endif

    loadEmbeddedWebView();
}

bool PrismSpectrumEditor::createWebView()
{
    auto options = makeWebOptions(*this, engine->scopeId());

#if JUCE_WINDOWS
    if (! juce::WebBrowserComponent::areOptionsSupported(options))
    {
        showWebViewFallback();
        return false;
    }
#endif

#if JUCE_LINUX
    logLinuxDiagnostic("creating WebBrowserComponent mode=" + juce::String(PRISM_LINUX_UI_MODE_NAME));
#endif

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    return true;
}

void PrismSpectrumEditor::loadEmbeddedWebView()
{
    if (! createWebView())
        return;

    addAndMakeVisible(*webView);

#if PRISM_USE_DEV_SERVER
   #if JUCE_LINUX
    logLinuxDiagnostic("navigating embedded WebView url=" + kDevServerUrl);
   #endif
    webView->goToURL(kDevServerUrl);
#elif PRISM_EMBED_WEBUI
   #if JUCE_LINUX
    const auto indexFile = writeLinuxWebViewIndexFile();

    if (indexFile.existsAsFile())
    {
        const auto url = juce::URL(indexFile).toString(false);
        logLinuxDiagnostic("navigating embedded WebView url=" + url);
        webView->goToURL(url);
        return;
    }

    logLinuxDiagnostic("navigating embedded WebView url=" + juce::WebBrowserComponent::getResourceProviderRoot());
   #endif
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
#endif
}

#if JUCE_LINUX
void PrismSpectrumEditor::showLinuxDiagnosticPlaceholder(const juce::String& text)
{
    webViewFallback.setText(text, juce::dontSendNotification);
    webViewFallback.setJustificationType(juce::Justification::centred);
    webViewFallback.setColour(juce::Label::backgroundColourId, juce::Colours::black);
    webViewFallback.setColour(juce::Label::textColourId, juce::Colour(0xffe5e7eb));
    webViewFallback.setMinimumHorizontalScale(0.7f);
    addAndMakeVisible(webViewFallback);
}

void PrismSpectrumEditor::loadNativeSmoke()
{
    logLinuxDiagnostic("native_smoke loaded");
    webViewReady = true;
    showLinuxDiagnosticPlaceholder("Prism native smoke test\n"
                                   "Root JUCE editor rendered without WebView\n"
                                   "Mode: native_smoke");
}

void PrismSpectrumEditor::loadWebSmoke()
{
    if (! createWebView())
        return;

    addAndMakeVisible(*webView);

    const auto url = makeWebSmokeUrl();
    logLinuxDiagnostic("navigating web_smoke WebView url=data:text/html;charset=utf-8,<inline smoke page>");
    webView->goToURL(url);
}

void PrismSpectrumEditor::loadFloatingWebView()
{
    showLinuxDiagnosticPlaceholder("Prism floating WebView diagnostic\n"
                                   "Embedded native placeholder is visible\n"
                                   "The real Prism WebView should open in a separate window");

    if (! createWebView())
        return;

    floatingWebViewWindow = std::make_unique<FloatingWebViewWindow>();
    floatingWebViewWindow->setContentNonOwned(webView.get(), false);

    const auto pref = engine->preferredSize();
    floatingWebViewWindow->setSize(pref.defaultWidth, pref.defaultHeight);
    floatingWebViewWindow->centreWithSize(pref.defaultWidth, pref.defaultHeight);
    floatingWebViewWindow->setVisible(true);
    floatingWebViewWindow->toFront(true);

   #if PRISM_USE_DEV_SERVER
    logLinuxDiagnostic("navigating floating WebView url=" + kDevServerUrl);
    webView->goToURL(kDevServerUrl);
   #elif PRISM_EMBED_WEBUI
    const auto indexFile = writeLinuxWebViewIndexFile();

    if (indexFile.existsAsFile())
    {
        const auto url = juce::URL(indexFile).toString(false);
        logLinuxDiagnostic("navigating floating WebView url=" + url);
        webView->goToURL(url);
        return;
    }

    logLinuxDiagnostic("navigating floating WebView url=" + juce::WebBrowserComponent::getResourceProviderRoot());
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
   #endif
}
#endif

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

#if JUCE_WINDOWS || JUCE_LINUX
void PrismSpectrumEditor::timerCallback()
{
    renderFrame();
}
#endif

void PrismSpectrumEditor::startFrameDriver()
{
    if (webView == nullptr || ! webViewReady || frameDriverStarted)
        return;

    frameDriverStarted = true;

#if JUCE_WINDOWS
    startTimerHz(resolveWindowsFrameRateHz(*this));
#elif JUCE_LINUX
    startTimerHz(kLinuxFrameRateHz);
#else
    // Drive frames at the display's refresh rate (adapts to 60/120/144 Hz).
    vblank = juce::VBlankAttachment(this, [this] { renderFrame(); });
#endif
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
#if JUCE_LINUX
    logLinuxDiagnostic("prismReady received mode=" + juce::String(PRISM_LINUX_UI_MODE_NAME)
                       + " scope=" + juce::String(engine->scopeId()));
#endif
    webViewReady = true;
    pushRestoreSettings();
    sendAppDefaults();
    startFrameDriver();
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
    if (webView == nullptr || ! webViewReady)
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

#if JUCE_LINUX
    if (drained <= 0)
        return;
#endif

    engine->process(drainLeft.data(), drainRight.data(), drained);

    webView->emitEventIfBrowserIsVisible(engine->frameEventId(), engine->buildFrame(sampleRate));
}

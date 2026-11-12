#ifdef _WIN32

#include <windows.h>
#include <unknwn.h>
#include <objbase.h>
#include "asio_capture.h"
#include "device_input_capture.h"
#include "iasiodrv.h"
#include "asiolist.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr long kMaxChannels = 8;
constexpr size_t kQueueCapacity = 32;
constexpr size_t kMaxFrames = 8192;

double nowMilliseconds() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

float readSample(const void* buffer, ASIOSampleType type, size_t index) {
    const auto* bytes = static_cast<const uint8_t*>(buffer);
    if (!bytes) return 0.0f;
    switch (type) {
        case ASIOSTFloat32LSB: {
            float value;
            std::memcpy(&value, bytes + index * 4, 4);
            return std::isfinite(value) ? value : 0.0f;
        }
        case ASIOSTFloat64LSB: {
            double value;
            std::memcpy(&value, bytes + index * 8, 8);
            return std::isfinite(value) ? static_cast<float>(value) : 0.0f;
        }
        case ASIOSTInt16LSB: {
            int16_t value;
            std::memcpy(&value, bytes + index * 2, 2);
            return static_cast<float>(value / 32768.0);
        }
        case ASIOSTInt24LSB: {
            const auto* sample = bytes + index * 3;
            int32_t value = static_cast<int32_t>(sample[0])
                | (static_cast<int32_t>(sample[1]) << 8)
                | (static_cast<int32_t>(sample[2]) << 16);
            if (value & 0x800000) value |= ~0xffffff;
            return static_cast<float>(value / 8388608.0);
        }
        case ASIOSTInt32LSB:
        case ASIOSTInt32LSB24:
        case ASIOSTInt32LSB20:
        case ASIOSTInt32LSB18:
        case ASIOSTInt32LSB16: {
            int32_t value;
            std::memcpy(&value, bytes + index * 4, 4);
            const int bits = type == ASIOSTInt32LSB24 ? 24
                : type == ASIOSTInt32LSB20 ? 20
                : type == ASIOSTInt32LSB18 ? 18
                : type == ASIOSTInt32LSB16 ? 16 : 32;
            return static_cast<float>(static_cast<double>(value) / std::ldexp(1.0, bits - 1));
        }
        default: return 0.0f;
    }
}

bool supportedType(ASIOSampleType type) {
    switch (type) {
        case ASIOSTFloat32LSB: case ASIOSTFloat64LSB:
        case ASIOSTInt16LSB: case ASIOSTInt24LSB: case ASIOSTInt32LSB:
        case ASIOSTInt32LSB16: case ASIOSTInt32LSB18:
        case ASIOSTInt32LSB20: case ASIOSTInt32LSB24:
            return true;
        default: return false;
    }
}

class AsioInputCapture final : public Prism::Capture::DeviceInputCapture {
public:
    Prism::Capture::Support getSupport() const override {
        AsioDriverList list;
        return {list.asioGetNumDev() > 0, list.asioGetNumDev() > 0 ? "" : "No ASIO drivers are registered."};
    }

    std::vector<Prism::Capture::OutputDevice> listInputDevices() override {
        AsioDriverList list;
        std::vector<Prism::Capture::OutputDevice> result;
        for (long index = 0; index < list.asioGetNumDev(); ++index) {
            char name[128] = {};
            if (list.asioGetDriverName(static_cast<int>(index), name, sizeof(name)) != 0) continue;
            Prism::Capture::OutputDevice device;
            device.id = std::string("asio:") + name;
            device.label = std::string("ASIO · ") + name;
            device.channelCount = kMaxChannels;
            for (uint32_t channel = 0; channel < kMaxChannels; ++channel) {
                device.channels.push_back({channel, "ASIO " + std::to_string(channel + 1)});
            }
            result.push_back(std::move(device));
        }
        return result;
    }

    bool start(const std::string& requestedDeviceId, Prism::Capture::StartResult* result,
               std::string* errorMessage) override {
        stop();
        const std::string name = requestedDeviceId.rfind("asio:", 0) == 0
            ? requestedDeviceId.substr(5) : requestedDeviceId;
        if (name.empty()) return fail("Select an ASIO driver.", errorMessage);
        drivers_ = std::make_unique<AsioDriverList>();
        for (long index = 0; index < drivers_->asioGetNumDev(); ++index) {
            char candidate[128] = {};
            if (drivers_->asioGetDriverName(static_cast<int>(index), candidate, sizeof(candidate)) == 0
                && name == candidate) {
                driverIndex_ = static_cast<int>(index);
                break;
            }
        }
        if (driverIndex_ < 0) { stop(); return fail("ASIO driver not found.", errorMessage); }
        void* rawDriver = nullptr;
        if (drivers_->asioOpenDriver(driverIndex_, &rawDriver) != 0 || !rawDriver) {
            stop(); return fail("Could not open the ASIO driver. It may already be in use.", errorMessage);
        }
        driver_ = static_cast<IASIO*>(rawDriver);
        if (!driver_->init(GetDesktopWindow())) {
            stop(); return fail("The ASIO driver could not initialize.", errorMessage);
        }
        long inputs = 0, outputs = 0;
        if (driver_->getChannels(&inputs, &outputs) != ASE_OK || inputs < 1) {
            stop(); return fail("The ASIO driver has no input channels.", errorMessage);
        }
        channelCount_ = static_cast<uint32_t>(std::min<long>(inputs, kMaxChannels));
        long minSize = 0, maxSize = 0, preferredSize = 0, granularity = 0;
        if (driver_->getBufferSize(&minSize, &maxSize, &preferredSize, &granularity) != ASE_OK
            || preferredSize < 1 || preferredSize > static_cast<long>(kMaxFrames)) {
            stop(); return fail("Unsupported ASIO buffer size.", errorMessage);
        }
        frames_ = static_cast<size_t>(preferredSize);
        ASIOSampleRate rate = 0;
        if (driver_->getSampleRate(&rate) != ASE_OK || rate < 8000 || rate > 384000) {
            stop(); return fail("The ASIO driver returned an invalid sample rate.", errorMessage);
        }
        sampleRate_ = rate;
        buffers_.resize(channelCount_);
        channelInfo_.resize(channelCount_);
        for (uint32_t channel = 0; channel < channelCount_; ++channel) {
            buffers_[channel] = {ASIOTrue, static_cast<long>(channel), {nullptr, nullptr}};
            channelInfo_[channel] = {};
            channelInfo_[channel].channel = static_cast<long>(channel);
            channelInfo_[channel].isInput = ASIOTrue;
            if (driver_->getChannelInfo(&channelInfo_[channel]) != ASE_OK
                || !supportedType(channelInfo_[channel].type)) {
                stop(); return fail("An ASIO input channel has an unsupported sample format.", errorMessage);
            }
        }
        for (auto& slot : queue_) {
            slot.channels.assign(channelCount_, std::vector<float>(frames_));
            slot.peaks.assign(channelCount_, 0.0f);
        }
        callbacks_ = {&onBufferSwitch, &onSampleRateChanged, &onMessage, &onBufferSwitchTimeInfo};
        if (driver_->createBuffers(buffers_.data(), static_cast<long>(channelCount_),
                                   preferredSize, &callbacks_) != ASE_OK) {
            stop(); return fail("ASIO could not create input buffers.", errorMessage);
        }
        buffersCreated_ = true;
        active_.store(this);
        running_.store(true);
        if (driver_->start() != ASE_OK) {
            stop(); return fail("ASIO could not start streaming.", errorMessage);
        }
        started_ = true;
        if (result) {
            result->sampleRate = sampleRate_;
            result->channelCount = channelCount_ > 1 ? 2 : 1;
            result->sourceChannelCount = channelCount_;
            result->deviceId = requestedDeviceId;
            result->deviceLabel = name;
        }
        return true;
    }

    Prism::Capture::ChannelRouting setChannelRouting(uint32_t left, uint32_t right) override {
        const uint32_t count = std::max<uint32_t>(1, channelCount_);
        left_.store(std::min(left, count - 1));
        right_.store(std::min(right, count - 1));
        return {left_.load(), right_.load()};
    }

    void stop() override {
        running_.store(false);
        active_.store(nullptr);
        if (driver_ && started_) driver_->stop();
        started_ = false;
        if (driver_ && buffersCreated_) driver_->disposeBuffers();
        buffersCreated_ = false;
        if (drivers_ && driverIndex_ >= 0) drivers_->asioCloseDriver(driverIndex_);
        driver_ = nullptr;
        driverIndex_ = -1;
        drivers_.reset();
        buffers_.clear();
        channelInfo_.clear();
        channelCount_ = 2;
        frames_ = 0;
        std::lock_guard<std::mutex> lock(queueMutex_);
        read_ = write_ = count_ = 0;
        overwriteCount_ = 0;
    }

    Prism::Capture::DrainResult drain(size_t maxChunks) override {
        Prism::Capture::DrainResult result;
        std::lock_guard<std::mutex> lock(queueMutex_);
        while (count_ && result.chunks.size() < maxChunks) {
            auto& slot = queue_[read_];
            Prism::Capture::AudioChunk chunk;
            chunk.sourceChannels = slot.channels;
            chunk.sourceChannelPeaks = slot.peaks;
            chunk.channelCount = channelCount_ > 1 ? 2 : 1;
            chunk.capturedAtMilliseconds = slot.timestamp;
            chunk.sequence = slot.sequence;
            chunk.left = slot.channels[left_.load()];
            chunk.right = slot.channels[right_.load()];
            result.chunks.push_back(std::move(chunk));
            read_ = (read_ + 1) % kQueueCapacity;
            --count_;
        }
        result.overwriteCount = overwriteCount_;
        result.queueDepth = count_;
        return result;
    }

    double nowMilliseconds() const override { return ::nowMilliseconds(); }

private:
    struct Slot {
        std::vector<std::vector<float>> channels;
        std::vector<float> peaks;
        double timestamp = 0;
        uint64_t sequence = 0;
    };

    bool fail(const char* message, std::string* error) const {
        if (error) *error = message;
        return false;
    }

    void capture(long index) {
        if (!running_.load() || index < 0 || index > 1) return;
        std::lock_guard<std::mutex> lock(queueMutex_);
        auto& slot = queue_[write_];
        for (uint32_t channel = 0; channel < channelCount_; ++channel) {
            float peak = 0.0f;
            const void* input = buffers_[channel].buffers[index];
            auto& samples = slot.channels[channel];
            for (size_t frame = 0; frame < frames_; ++frame) {
                const float sample = readSample(input, channelInfo_[channel].type, frame);
                samples[frame] = sample;
                peak = std::max(peak, std::abs(sample));
            }
            slot.peaks[channel] = peak;
        }
        slot.timestamp = ::nowMilliseconds();
        slot.sequence = ++sequence_;
        if (count_ == kQueueCapacity) {
            read_ = (read_ + 1) % kQueueCapacity;
            ++overwriteCount_;
        } else {
            ++count_;
        }
        write_ = (write_ + 1) % kQueueCapacity;
    }

    static void onBufferSwitch(long index, ASIOBool) {
        if (auto* capture = active_.load()) capture->capture(index);
    }
    static ASIOTime* onBufferSwitchTimeInfo(ASIOTime* time, long index, ASIOBool direct) {
        onBufferSwitch(index, direct);
        return time;
    }
    static void onSampleRateChanged(ASIOSampleRate) {}
    static long onMessage(long selector, long value, void*, double*) {
        if (selector == kAsioSelectorSupported)
            return value == kAsioEngineVersion || value == kAsioSupportsTimeInfo ? 1 : 0;
        if (selector == kAsioEngineVersion) return 2;
        if (selector == kAsioSupportsTimeInfo) return 1;
        return 0;
    }

    static std::atomic<AsioInputCapture*> active_;
    std::unique_ptr<AsioDriverList> drivers_;
    IASIO* driver_ = nullptr;
    int driverIndex_ = -1;
    ASIOCallbacks callbacks_{};
    std::vector<ASIOBufferInfo> buffers_;
    std::vector<ASIOChannelInfo> channelInfo_;
    std::array<Slot, kQueueCapacity> queue_;
    std::mutex queueMutex_;
    size_t read_ = 0, write_ = 0, count_ = 0;
    uint64_t sequence_ = 0, overwriteCount_ = 0;
    uint32_t channelCount_ = 2;
    size_t frames_ = 0;
    double sampleRate_ = 48000;
    std::atomic<uint32_t> left_{0}, right_{1};
    std::atomic<bool> running_{false};
    bool buffersCreated_ = false;
    bool started_ = false;
};

std::atomic<AsioInputCapture*> AsioInputCapture::active_{nullptr};
std::unique_ptr<AsioInputCapture>& captureInstance() {
    static auto instance = std::make_unique<AsioInputCapture>();
    return instance;
}

Napi::Value getSupport(const Napi::CallbackInfo& info) {
    auto support = captureInstance()->getSupport();
    auto result = Napi::Object::New(info.Env());
    result.Set("available", Napi::Boolean::New(info.Env(), support.available));
    result.Set("reason", support.reason.empty() ? static_cast<Napi::Value>(info.Env().Null())
        : static_cast<Napi::Value>(Napi::String::New(info.Env(), support.reason)));
    return result;
}
Napi::Value listInputDevices(const Napi::CallbackInfo& info) {
    auto devices = captureInstance()->listInputDevices();
    auto result = Napi::Array::New(info.Env(), devices.size());
    for (size_t index = 0; index < devices.size(); ++index) {
        const auto& device = devices[index];
        auto entry = Napi::Object::New(info.Env());
        entry.Set("id", Napi::String::New(info.Env(), device.id));
        entry.Set("label", Napi::String::New(info.Env(), device.label));
        entry.Set("kind", Napi::String::New(info.Env(), "device"));
        entry.Set("isDefault", Napi::Boolean::New(info.Env(), false));
        entry.Set("sampleRate", Napi::Number::New(info.Env(), device.sampleRate));
        entry.Set("channelCount", Napi::Number::New(info.Env(), device.channelCount));
        entry.Set("channelRoutingAvailable", Napi::Boolean::New(info.Env(), true));
        auto channels = Napi::Array::New(info.Env(), device.channels.size());
        for (size_t channel = 0; channel < device.channels.size(); ++channel) {
            auto item = Napi::Object::New(info.Env());
            item.Set("index", Napi::Number::New(info.Env(), device.channels[channel].index));
            item.Set("label", Napi::String::New(info.Env(), device.channels[channel].label));
            channels.Set(static_cast<uint32_t>(channel), item);
        }
        entry.Set("channels", channels);
        result.Set(static_cast<uint32_t>(index), entry);
    }
    return result;
}
Napi::Value start(const Napi::CallbackInfo& info) {
    const std::string id = info.Length() && info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
    captureInstance()->stop();
    captureInstance()->setChannelRouting(0, 1);
    if (info.Length() > 1 && info[1].IsObject()) {
        auto routing = info[1].As<Napi::Object>();
        if (routing.Has("left") && routing.Has("right")) {
            captureInstance()->setChannelRouting(routing.Get("left").As<Napi::Number>().Uint32Value(),
                                                 routing.Get("right").As<Napi::Number>().Uint32Value());
        }
    }
    Prism::Capture::StartResult started;
    std::string error;
    if (!captureInstance()->start(id, &started, &error)) {
        Napi::Error::New(info.Env(), error).ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }
    auto result = Napi::Object::New(info.Env());
    result.Set("sampleRate", Napi::Number::New(info.Env(), started.sampleRate));
    result.Set("channelCount", Napi::Number::New(info.Env(), started.channelCount));
    result.Set("sourceChannelCount", Napi::Number::New(info.Env(), started.sourceChannelCount));
    result.Set("deviceId", Napi::String::New(info.Env(), started.deviceId));
    result.Set("deviceLabel", Napi::String::New(info.Env(), started.deviceLabel));
    return result;
}
Napi::Value setRouting(const Napi::CallbackInfo& info) {
    auto routing = captureInstance()->setChannelRouting(
        info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Number>().Uint32Value());
    auto result = Napi::Object::New(info.Env());
    result.Set("left", Napi::Number::New(info.Env(), routing.left));
    result.Set("right", Napi::Number::New(info.Env(), routing.right));
    return result;
}
Napi::Value stop(const Napi::CallbackInfo& info) {
    captureInstance()->stop();
    return info.Env().Undefined();
}
Napi::Value drain(const Napi::CallbackInfo& info) {
    size_t maxChunks = 32;
    if (info.Length() && info[0].IsNumber())
        maxChunks = std::min<size_t>(256, std::max<int64_t>(1, info[0].As<Napi::Number>().Int64Value()));
    auto drained = captureInstance()->drain(maxChunks);
    auto chunks = Napi::Array::New(info.Env(), drained.chunks.size());
    for (size_t index = 0; index < drained.chunks.size(); ++index) {
        auto& chunk = drained.chunks[index];
        auto entry = Napi::Object::New(info.Env());
        auto left = Napi::Float32Array::New(info.Env(), chunk.left.size());
        auto right = Napi::Float32Array::New(info.Env(), chunk.right.size());
        if (!chunk.left.empty()) std::memcpy(left.Data(), chunk.left.data(), chunk.left.size() * sizeof(float));
        if (!chunk.right.empty()) std::memcpy(right.Data(), chunk.right.data(), chunk.right.size() * sizeof(float));
        entry.Set("left", left);
        entry.Set("right", right);
        auto channels = Napi::Array::New(info.Env(), chunk.sourceChannels.size());
        for (size_t channel = 0; channel < chunk.sourceChannels.size(); ++channel) {
            const auto& samples = chunk.sourceChannels[channel];
            auto values = Napi::Float32Array::New(info.Env(), samples.size());
            if (!samples.empty()) std::memcpy(values.Data(), samples.data(), samples.size() * sizeof(float));
            channels.Set(static_cast<uint32_t>(channel), values);
        }
        entry.Set("sourceChannels", channels);
        auto peaks = Napi::Float32Array::New(info.Env(), chunk.sourceChannelPeaks.size());
        if (!chunk.sourceChannelPeaks.empty())
            std::memcpy(peaks.Data(), chunk.sourceChannelPeaks.data(), chunk.sourceChannelPeaks.size() * sizeof(float));
        entry.Set("sourceChannelPeaks", peaks);
        entry.Set("channelCount", Napi::Number::New(info.Env(), chunk.channelCount));
        entry.Set("capturedAtMilliseconds", Napi::Number::New(info.Env(), chunk.capturedAtMilliseconds));
        entry.Set("sequence", Napi::Number::New(info.Env(), static_cast<double>(chunk.sequence)));
        chunks.Set(static_cast<uint32_t>(index), entry);
    }
    auto result = Napi::Object::New(info.Env());
    result.Set("chunks", chunks);
    result.Set("overwriteCount", Napi::Number::New(info.Env(), static_cast<double>(drained.overwriteCount)));
    result.Set("queueDepth", Napi::Number::New(info.Env(), drained.queueDepth));
    return result;
}
Napi::Value now(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), captureInstance()->nowMilliseconds()); }

} // namespace

void RegisterAsioCapture(Napi::Env env, Napi::Object exports) {
    auto capture = Napi::Object::New(env);
    capture.Set("getSupport", Napi::Function::New(env, getSupport));
    capture.Set("listInputDevices", Napi::Function::New(env, listInputDevices));
    capture.Set("start", Napi::Function::New(env, start));
    capture.Set("setChannelRouting", Napi::Function::New(env, setRouting));
    capture.Set("stop", Napi::Function::New(env, stop));
    capture.Set("drain", Napi::Function::New(env, drain));
    capture.Set("nowMilliseconds", Napi::Function::New(env, now));
    exports.Set("asioCapture", capture);
}

#endif

// D2 application render loopback. No endpoint/microphone capture or routing changes.
// Windows SDK API contract: https://learn.microsoft.com/windows/win32/api/audioclientactivationparams/
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <audioclientactivationparams.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <vector>
#include <algorithm>
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

using AudioCallback = int (__stdcall *)(const BYTE*, UINT32, UINT64, DWORD);
struct Handle {
    HANDLE h = nullptr;
    explicit Handle(HANDLE value = nullptr) : h(value) {}
    ~Handle() { if (h) CloseHandle(h); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
static UINT64 creation(HANDLE process) {
    FILETIME birth{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(process, &birth, &exit, &kernel, &user)) return 0;
    return (UINT64(birth.dwHighDateTime) << 32) | birth.dwLowDateTime;
}
static bool identity(HWND window, DWORD pid, HANDLE process, UINT64 born) {
    DWORD current = 0;
    return IsWindow(window) && GetWindowThreadProcessId(window, &current) && current == pid &&
        pid != 0 && pid != GetCurrentProcessId() &&
        WaitForSingleObject(process, 0) == WAIT_TIMEOUT && creation(process) == born;
}
class Activation final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                                             IActivateAudioInterfaceCompletionHandler> {
public:
    Handle completed{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    HRESULT result = E_PENDING;
    ComPtr<IAudioClient> client;
    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    PROPVARIANT variant{};
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
        HRESULT activationResult = E_FAIL;
        ComPtr<IUnknown> unknown;
        result = operation->GetActivateResult(&activationResult, &unknown);
        if (SUCCEEDED(result)) result = activationResult;
        if (SUCCEEDED(result)) result = unknown.As(&client);
        SetEvent(completed.h);
        return S_OK;
    }
};
extern "C" __declspec(dllexport) UINT32 __cdecl d2_loopback_abi() { return 1; }
extern "C" __declspec(dllexport) HRESULT __cdecl d2_loopback_identity(
    HWND window, DWORD* pid, UINT64* born) {
    if (!pid || !born) return E_INVALIDARG;
    *pid = 0; *born = 0;
    DWORD owner = 0;
    if (!IsWindow(window) || !GetWindowThreadProcessId(window, &owner) || !owner || owner == GetCurrentProcessId()) return E_ACCESSDENIED;
    Handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, owner)};
    if (!process.h) return HRESULT_FROM_WIN32(GetLastError());
    UINT64 birth = creation(process.h);
    if (!birth || !identity(window, owner, process.h, birth)) return E_ACCESSDENIED;
    *pid = owner; *born = birth;
    return S_OK;
}
static HRESULT capture(HWND window, DWORD pid, UINT64 born, HANDLE stop, AudioCallback callback) {
    if (!callback || !stop || !born) return E_INVALIDARG;
    Handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid)};
    if (!process.h || !identity(window, pid, process.h, born)) return E_ACCESSDENIED;
    auto activation = Make<Activation>();
    if (!activation || !activation->completed.h) return E_OUTOFMEMORY;
    activation->params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activation->params.ProcessLoopbackParams.TargetProcessId = pid;
    activation->params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    activation->variant.vt = VT_BLOB;
    activation->variant.blob.cbSize = sizeof(activation->params);
    activation->variant.blob.pBlobData = reinterpret_cast<BYTE*>(&activation->params);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
        &activation->variant, activation.Get(), &operation);
    if (FAILED(hr)) return hr;
    HANDLE activateWait[] = {stop, activation->completed.h};
    DWORD wait = WaitForMultipleObjects(2, activateWait, FALSE, 8000);
    if (wait == WAIT_OBJECT_0) return S_OK;
    if (wait != WAIT_OBJECT_0 + 1) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    if (FAILED(activation->result)) return activation->result;
    if (!identity(window, pid, process.h, born)) return E_ACCESSDENIED;
    auto client = activation->client;
    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 2;
    format.nSamplesPerSec = 48000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 4;
    format.nAvgBytesPerSec = 192000;
    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        0, 0, &format, nullptr);
    if (FAILED(hr)) return hr;
    Handle samples{CreateEventW(nullptr, FALSE, FALSE, nullptr)};
    if (!samples.h) return HRESULT_FROM_WIN32(GetLastError());
    hr = client->SetEventHandle(samples.h);
    if (FAILED(hr)) return hr;
    ComPtr<IAudioCaptureClient> reader;
    hr = client->GetService(IID_PPV_ARGS(&reader));
    if (FAILED(hr)) return hr;
    hr = client->Start();
    if (FAILED(hr)) return hr;
    struct StopClient { IAudioClient* client; ~StopClient(){ client->Stop(); } } cleanup{client.Get()};
    if (!callback(nullptr, 0, 0, 0)) return E_ABORT; // Ready, no audio recorded.
    LARGE_INTEGER frequency{};
    QueryPerformanceFrequency(&frequency);
    HANDLE waits[] = {stop, process.h, samples.h};
    for (;;) {
        wait = WaitForMultipleObjects(3, waits, FALSE, 50);
        if (wait == WAIT_OBJECT_0) return S_OK;
        if (wait == WAIT_FAILED) return HRESULT_FROM_WIN32(GetLastError());
        if (!identity(window, pid, process.h, born)) return E_ACCESSDENIED;
        UINT32 frames = 0;
        while (SUCCEEDED(hr = reader->GetNextPacketSize(&frames)) && frames) {
            if (WaitForSingleObject(stop, 0) == WAIT_OBJECT_0) return S_OK;
            BYTE* data = nullptr; DWORD flags = 0; UINT64 device = 0, qpc = 0;
            hr = reader->GetBuffer(&data, &frames, &flags, &device, &qpc);
            if (FAILED(hr)) return hr;
            if (frames > 48000) { reader->ReleaseBuffer(frames); return E_UNEXPECTED; }
            std::vector<BYTE> silence;
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.resize(size_t(frames)*4); data = silence.data(); }
            LARGE_INTEGER counter{}; QueryPerformanceCounter(&counter);
            UINT64 current = UINT64((static_cast<long double>(counter.QuadPart)*10000000)/frequency.QuadPart);
            UINT64 age = (!(flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) && qpc && current >= qpc)
                ? (current-qpc)/10 : UINT64(frames)*1000000/48000;
            int accepted = data ? callback(data, frames, age, flags) : 0;
            HRESULT released = reader->ReleaseBuffer(frames);
            if (!accepted) return E_ABORT;
            if (FAILED(released)) return released;
        }
        if (FAILED(hr)) return hr;
    }
}
extern "C" __declspec(dllexport) HRESULT __cdecl d2_loopback_run(
    HWND window, DWORD pid, UINT64 born, HANDLE stop, AudioCallback callback) {
    HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(initialized)) return initialized;
    HRESULT result;
    try { result = capture(window, pid, born, stop, callback); }
    catch (...) { result = E_FAIL; }
    CoUninitialize();
    return result;
}

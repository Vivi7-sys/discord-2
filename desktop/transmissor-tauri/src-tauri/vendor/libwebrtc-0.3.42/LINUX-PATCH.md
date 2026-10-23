# Linux RTC statistics crash fix

Vendored unmodified crates.io libwebrtc 0.3.42 except src/lib.rs, the three native get_stats callbacks, and src/stats_callback.rs. Apache-2.0 upstream license applies. Source: https://crates.io/crates/libwebrtc/0.3.42 and https://github.com/livekit/rust-sdks.

Linux callbacks replace JSON/context unwraps with explicit error completion. Empty reports retain upstream behavior. Malformed reports return RtcError::Internal; dropped callers are harmless and wrong contexts are dropped, closing their oneshot channel. No catch_unwind, new SDK versions, or media error suppression. Non-Linux callbacks retain original code under cfg. The patch applies to sender, receiver, and peer connection to protect every RTC stats entry point.

Application diagnostics log optional errors and continue media ingestion; encoding/publication metrics become unavailable instead of fabricated. Capture/transport/room errors retain the existing failure path. Debug probes can isolate statistics and privately capture the malformed native report; release binaries always use real stats and do not dump reports.

Regression tests compile this exact callback helper in tests/linux_rtc_stats.rs. A syntactically invalid key reproduces the reported parser error and verifies oneshot completion; additional malformed, cancelled, empty and valid cases are included.

Upstream main was checked during investigation: the same JSON unwrap remained in all three callbacks. Updating the whole stack would not fix that code path and would risk compatibility of the pinned SDK stack.

Confirmed producer defect: linked linux-x64-release-webrtc-51ef663 RTCIceCandidatePairStats::ToJson emits `currentRoundTripTime:0,125` under LC_NUMERIC=pt_BR.UTF-8, while the same value emits `0.125` under C. This fails JSON syntax before typed deserialization. GTK initializes the process locale; CLI media probes previously ran with the C numeric locale. The fix deliberately does not change the process locale or repair ambiguous JSON. Such diagnostics return unavailable; media and capture failures remain independent and fatal as before.

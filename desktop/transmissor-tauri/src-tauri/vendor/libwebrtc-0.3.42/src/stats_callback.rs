// Copyright 2026 LiveKit, Inc. and Discord 2 contributors.
// SPDX-License-Identifier: Apache-2.0
// Linux patch: optional diagnostics must never unwind through a CXX callback.
use crate::{stats::RtcStats, RtcError, RtcErrorType};
use std::any::Any;
use tokio::sync::oneshot;

type StatsReply = Result<Vec<RtcStats>, RtcError>;

pub(crate) fn complete_stats(context: Box<dyn Any + Send>, json: &str) {
    // A mismatched context is dropped: the original oneshot sender is dropped
    // with it, so its awaiting caller receives cancellation rather than hanging.
    if let Ok(sender) = context.downcast::<oneshot::Sender<StatsReply>>() {
        let reply = parse_stats(json);
        // The caller may already have timed out or stopped. Sending must not panic.
        let _ = sender.send(reply);
    }
}

fn parse_stats(json: &str) -> StatsReply {
    if json.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(json).map_err(|error| {
        // Debug probe only: retain the native response for a local, private
        // investigation. Release binaries never write stats reports to disk.
        if cfg!(debug_assertions) {
            if let Some(path) = std::env::var_os("D2_TEST_RTC_STATS_REPORT_PATH") {
                let _ = std::fs::write(path, json);
            }
        }
        RtcError {
            error_type: RtcErrorType::Internal,
            // Do not log the report: candidate addresses and certificate information
            // can be present. The parser location/category are sufficient diagnostics.
            message: format!("Invalid optional RTC stats JSON: {error}"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn malformed_json_completes_channel_with_error() {
        // Reproduces serde_json's exact "key must be a string" failure class.
        let (tx, rx) = oneshot::channel::<StatsReply>();
        complete_stats(
            Box::new(tx),
            r#"[{"type":"outbound-rtp","qualityLimitationDurations":{0:1}}]"#,
        );
        let error = rx.await.unwrap().unwrap_err();
        assert!(error.message.contains("key must be a string"));
        assert_eq!(error.error_type, RtcErrorType::Internal);
    }

    #[tokio::test]
    async fn truncated_and_wrong_schema_are_errors() {
        for report in ["[{", "null", "{}", "[1]", r#"[{"type":"unknown"}]"#] {
            let (tx, rx) = oneshot::channel::<StatsReply>();
            complete_stats(Box::new(tx), report);
            assert!(rx.await.unwrap().is_err(), "{report}");
        }
    }

    #[tokio::test]
    async fn empty_and_valid_reports_complete_normally() {
        for report in ["", "[]"] {
            let (tx, rx) = oneshot::channel::<StatsReply>();
            complete_stats(Box::new(tx), report);
            assert!(rx.await.unwrap().unwrap().is_empty());
        }
    }

    #[test]
    fn cancelled_caller_and_unexpected_context_do_not_panic() {
        let (tx, rx) = oneshot::channel::<StatsReply>();
        drop(rx);
        complete_stats(Box::new(tx), "{");
        complete_stats(Box::new(123u32), "{");
    }
}

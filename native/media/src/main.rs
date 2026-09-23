//! WavePet 미디어 헬퍼: Windows 미디어 세션(SMTC, 볼륨 키를 누르면 뜨는 미디어 팝업과
//! 같은 정보)에서 곡 제목/아티스트/재생 위치를 읽어 알리고, 재생 조작 명령을 받는다.
//! 크롬/엣지의 유튜브, 스포티파이 등 SMTC에 정보를 올리는 앱이면 동작한다.
//!
//! - stdout: 정보가 바뀔 때마다 JSON 한 줄. 재생 위치는 흐르는 대로 앱이 보정하므로
//!   되감기/건너뛰기처럼 예상과 1초 넘게 어긋날 때만 다시 알린다.
//!   {"has":true,"playing":true,"title":"...","artist":"...","app":"...",
//!    "position":83.2,"duration":256.0}      (초 단위, 길이를 모르면 duration 0)
//!   {"has":false}                            (조작할 세션 없음)
//! - stdin: 명령 한 줄씩 "toggle" | "next" | "prev". stdin이 닫히면(부모 앱 종료) 끝난다.
//! - 세션 고르기: "재생 중"인 세션을 우선, 없으면 Windows가 고른 현재 세션(일시정지 포함).

use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::json;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

const POLL_INTERVAL: Duration = Duration::from_millis(250); // 재생/일시정지를 빨리 알리려고 짧게
const SEEK_TOLERANCE_SEC: f64 = 1.0;
const TICKS_PER_SEC: f64 = 10_000_000.0; // WinRT 시간 단위 100ns
const UNIX_EPOCH_AS_WINRT_TICKS: i64 = 116_444_736_000_000_000; // 1601-01-01 기준

fn is_playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == Status::Playing)
        .unwrap_or(false)
}

fn pick_session(manager: &Manager) -> Option<Session> {
    let playing = manager.GetSessions().ok().and_then(|sessions| {
        (0..sessions.Size().unwrap_or(0))
            .filter_map(|i| sessions.GetAt(i).ok())
            .find(is_playing)
    });
    playing.or_else(|| manager.GetCurrentSession().ok())
}

fn now_winrt_ticks() -> i64 {
    let since_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    UNIX_EPOCH_AS_WINRT_TICKS + (since_unix.as_nanos() / 100) as i64
}

/// (현재 위치, 전체 길이) 초. 앱이 위치를 마지막으로 알려 준 뒤 흐른 시간을 더해 보정한다.
fn timeline(session: &Session, playing: bool) -> (f64, f64) {
    let Ok(t) = session.GetTimelineProperties() else {
        return (0.0, 0.0);
    };
    let start = t.StartTime().map(|v| v.Duration).unwrap_or(0);
    let end = t.EndTime().map(|v| v.Duration).unwrap_or(0);
    let mut pos = t.Position().map(|v| v.Duration).unwrap_or(0) - start;
    if playing {
        if let Ok(updated) = t.LastUpdatedTime() {
            if updated.UniversalTime > 0 {
                pos += (now_winrt_ticks() - updated.UniversalTime).max(0);
            }
        }
    }
    let duration = (end - start).max(0);
    if duration > 0 {
        pos = pos.clamp(0, duration);
    }
    (pos.max(0) as f64 / TICKS_PER_SEC, duration as f64 / TICKS_PER_SEC)
}

fn describe(session: Option<&Session>) -> serde_json::Value {
    let Some(session) = session else {
        return json!({ "has": false });
    };
    let (title, artist) = match session.TryGetMediaPropertiesAsync().and_then(|op| op.join()) {
        Ok(p) => (
            p.Title().map(|s| s.to_string()).unwrap_or_default(),
            p.Artist().map(|s| s.to_string()).unwrap_or_default(),
        ),
        Err(_) => (String::new(), String::new()),
    };
    if title.is_empty() {
        return json!({ "has": false });
    }
    let playing = is_playing(session);
    let (position, duration) = timeline(session, playing);
    let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
    json!({
        "has": true,
        "playing": playing,
        "title": title,
        "artist": artist,
        "app": app,
        "position": (position * 10.0).round() / 10.0,
        "duration": (duration * 10.0).round() / 10.0,
    })
}

/// 재생 위치 말고 다른 것이 바뀌었거나, 위치가 흐른 시간으로 예상한 값과 크게 어긋날 때만 알린다.
fn should_emit(last: Option<&(serde_json::Value, Instant)>, info: &serde_json::Value) -> bool {
    let Some((prev, sent_at)) = last else { return true };
    let without_position = |v: &serde_json::Value| {
        let mut v = v.clone();
        if let Some(obj) = v.as_object_mut() {
            obj.remove("position");
        }
        v
    };
    if without_position(prev) != without_position(info) {
        return true;
    }
    let pos = |v: &serde_json::Value| v["position"].as_f64().unwrap_or(0.0);
    let mut expected = pos(prev);
    if prev["playing"].as_bool().unwrap_or(false) {
        expected += sent_at.elapsed().as_secs_f64();
    }
    (pos(info) - expected).abs() > SEEK_TOLERANCE_SEC
}

fn run_command(session: Option<&Session>, cmd: &str) {
    let Some(session) = session else { return };
    let result = match cmd {
        "toggle" => session.TryTogglePlayPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "prev" => session.TrySkipPreviousAsync(),
        _ => return,
    };
    if let Err(err) = result.and_then(|op| op.join()) {
        eprintln!("error {cmd}: {err}");
    }
}

fn main() {
    // stdin: 명령 줄. 닫히면(부모 앱 종료) 끝낸다.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(cmd) => {
                    if tx.send(cmd.trim().to_string()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        std::process::exit(0);
    });

    let manager = match Manager::RequestAsync().and_then(|op| op.join()) {
        Ok(m) => m,
        Err(err) => {
            eprintln!("error {err}");
            std::process::exit(1);
        }
    };

    let mut last: Option<(serde_json::Value, Instant)> = None;
    loop {
        let session = pick_session(&manager);
        let info = describe(session.as_ref());
        if should_emit(last.as_ref(), &info) {
            let mut out = io::stdout();
            if writeln!(out, "{info}").and_then(|_| out.flush()).is_err() {
                std::process::exit(0);
            }
            last = Some((info, Instant::now()));
        }

        // 명령이 오면 바로 실행하고 곧장 상태를 다시 알린다
        if let Ok(cmd) = rx.recv_timeout(POLL_INTERVAL) {
            run_command(session.as_ref(), &cmd);
            std::thread::sleep(Duration::from_millis(150)); // 앱이 상태를 반영할 시간
        }
    }
}

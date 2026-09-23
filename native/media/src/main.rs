//! WavePet 미디어 정보 헬퍼: Windows 미디어 세션(SMTC, 볼륨 키를 누르면 뜨는 미디어 팝업과
//! 같은 정보)에서 지금 재생 중인 곡의 제목/아티스트를 읽어 표준 출력으로 알린다.
//! 크롬/엣지의 유튜브, 스포티파이 등 SMTC에 정보를 올리는 앱이면 읽을 수 있다.
//!
//! - stdout: 재생 정보가 바뀔 때마다 JSON 한 줄
//!   {"playing":true,"title":"...","artist":"...","app":"..."} / {"playing":false}
//! - 1초마다 확인한다. 여러 앱이 있으면 "재생 중"인 세션을 우선한다.
//! - stdin이 닫히면(부모 앱 종료) 스스로 끝난다.

use std::io::{self, Read, Write};
use std::time::Duration;

use serde_json::json;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

const POLL_INTERVAL: Duration = Duration::from_secs(1);

fn is_playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == Status::Playing)
        .unwrap_or(false)
}

/// 재생 중인 세션(없으면 None)의 정보를 JSON으로
fn now_playing(manager: &Manager) -> serde_json::Value {
    let playing = manager.GetSessions().ok().and_then(|sessions| {
        (0..sessions.Size().unwrap_or(0))
            .filter_map(|i| sessions.GetAt(i).ok())
            .find(is_playing)
    });
    let Some(session) = playing else {
        return json!({ "playing": false });
    };
    let props = session.TryGetMediaPropertiesAsync().and_then(|op| op.join());
    let (title, artist) = match props {
        Ok(p) => (
            p.Title().map(|s| s.to_string()).unwrap_or_default(),
            p.Artist().map(|s| s.to_string()).unwrap_or_default(),
        ),
        Err(_) => (String::new(), String::new()),
    };
    let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
    if title.is_empty() {
        return json!({ "playing": false });
    }
    json!({ "playing": true, "title": title, "artist": artist, "app": app })
}

fn main() {
    // 부모 앱이 죽으면 stdin이 닫힌다
    std::thread::spawn(|| {
        let mut buf = [0u8; 64];
        let mut stdin = io::stdin();
        while matches!(stdin.read(&mut buf), Ok(n) if n > 0) {}
        std::process::exit(0);
    });

    let manager = match Manager::RequestAsync().and_then(|op| op.join()) {
        Ok(m) => m,
        Err(err) => {
            eprintln!("error {err}");
            std::process::exit(1);
        }
    };

    let mut last = String::new();
    loop {
        let line = now_playing(&manager).to_string();
        if line != last {
            let mut out = io::stdout();
            if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
                std::process::exit(0);
            }
            last = line;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

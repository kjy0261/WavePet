//! WavePet 오디오 헬퍼: 특정 프로그램(기본 Discord.exe)의 소리만 뺀 시스템 소리를 캡처해
//! 표준 출력으로 흘려 보낸다. Windows의 프로세스 루프백(EXCLUDE_TARGET_PROCESS_TREE)을
//! 쓰므로 Windows 10 빌드 20348 이상(사실상 Windows 11)이 필요하다.
//!
//! 사용법: wavepet-loopback.exe --exclude Discord.exe
//!
//! - stdout: 48kHz 모노 f32 리틀엔디언 PCM, 20ms(960프레임) 단위
//! - stderr: 상태 한 줄씩 ("status excluding Discord.exe 1234", "status all", "error ...")
//! - 제외할 프로그램이 안 켜져 있으면 자기 자신을 제외 대상으로 잡아 사실상 전체 소리를 캡처하고,
//!   몇 초마다 다시 찾아 켜지거나 꺼지면 캡처를 새로 시작한다.
//! - stdin이 닫히면(부모 앱 종료) 스스로 끝난다.

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::time::{Duration, Instant};

use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};

const SAMPLE_RATE: usize = 48_000;
const CHANNELS: usize = 2;
const CHUNK_FRAMES: usize = 960; // 20ms
const RECHECK_INTERVAL: Duration = Duration::from_secs(3);
const RETRY_DELAY: Duration = Duration::from_secs(2);

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn status(line: &str) {
    let mut err = io::stderr();
    let _ = writeln!(err, "{line}");
    let _ = err.flush();
}

/// 이름이 `exe_name`인 프로세스들 중 부모가 같은 이름이 아닌 것(프로세스 트리의 뿌리) PID.
fn find_root_pid(exe_name: &str) -> Option<u32> {
    let mut procs: Vec<(u32, u32)> = Vec::new(); // (pid, parent pid)
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if name.eq_ignore_ascii_case(exe_name) {
                    procs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    procs
        .iter()
        .find(|(_, parent)| !procs.iter().any(|(pid, _)| pid == parent))
        .map(|(pid, _)| *pid)
}

/// 제외 대상 PID가 바뀔 때까지(Ok) 또는 오류가 날 때까지(Err) 캡처해서 stdout으로 보낸다.
fn capture(exclude_pid: u32, exclude_name: &str, out: &mut impl Write) -> Res<()> {
    let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE, CHANNELS, None);
    let block_align = format.get_blockalign() as usize;

    let mut client = AudioClient::new_application_loopback_client(exclude_pid, false)?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
    client.initialize_client(&format, &Direction::Capture, &mode)?;
    let event = client.set_get_eventhandle()?;
    let capture_client = client.get_audiocaptureclient()?;

    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut chunk = Vec::with_capacity(CHUNK_FRAMES * 4);
    let mut last_check = Instant::now();

    client.start_stream()?;
    loop {
        // 소리가 안 나는 동안은 이벤트가 안 올 수 있으므로 타임아웃은 오류로 보지 않는다.
        let _ = event.wait_for_event(100);

        while capture_client.get_next_packet_size()?.unwrap_or(0) > 0 {
            capture_client.read_from_device_to_deque(&mut queue)?;
        }

        while queue.len() >= CHUNK_FRAMES * block_align {
            chunk.clear();
            for _ in 0..CHUNK_FRAMES {
                let mut sum = 0.0f32;
                for _ in 0..CHANNELS {
                    let bytes = [
                        queue.pop_front().unwrap(),
                        queue.pop_front().unwrap(),
                        queue.pop_front().unwrap(),
                        queue.pop_front().unwrap(),
                    ];
                    sum += f32::from_le_bytes(bytes);
                }
                chunk.extend_from_slice(&(sum / CHANNELS as f32).to_le_bytes());
            }
            if out.write_all(&chunk).and_then(|_| out.flush()).is_err() {
                std::process::exit(0); // 부모가 파이프를 닫음
            }
        }

        if last_check.elapsed() >= RECHECK_INTERVAL {
            last_check = Instant::now();
            let target = find_root_pid(exclude_name).unwrap_or(std::process::id());
            if target != exclude_pid {
                let _ = client.stop_stream();
                return Ok(());
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let exclude_name = match args.iter().position(|a| a == "--exclude") {
        Some(i) if i + 1 < args.len() => args[i + 1].clone(),
        _ => {
            status("error usage: wavepet-loopback.exe --exclude <program.exe>");
            std::process::exit(2);
        }
    };

    // 부모 앱이 죽으면 stdin이 닫힌다. 소리가 없어 stdout에 쓸 일이 없어도 끝나도록 따로 감시.
    std::thread::spawn(|| {
        let mut buf = [0u8; 64];
        let mut stdin = io::stdin();
        while matches!(stdin.read(&mut buf), Ok(n) if n > 0) {}
        std::process::exit(0);
    });

    if initialize_mta().is_err() {
        status("error COM init failed");
        std::process::exit(1);
    }

    let stdout = io::stdout();
    let mut out = stdout.lock();
    loop {
        let (pid, line) = match find_root_pid(&exclude_name) {
            Some(pid) => (pid, format!("status excluding {exclude_name} {pid}")),
            // 제외할 프로그램이 없으면 자기 자신을 제외 = 전체 소리
            None => (std::process::id(), "status all".to_string()),
        };
        status(&line);
        if let Err(err) = capture(pid, &exclude_name, &mut out) {
            status(&format!("error {err}"));
            std::thread::sleep(RETRY_DELAY);
        }
    }
}

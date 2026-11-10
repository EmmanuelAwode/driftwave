//! Thin wrapper around the bundled FFmpeg executable.
//!
//! FFmpeg ships next to the application binary as a Tauri sidecar
//! (`binaries/ffmpeg-<target>.exe` is copied to `ffmpeg.exe` beside the app).
//! All decoding, Rubber Band time-stretching and final encoding go through here.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Highest sample rate we keep internally. Hi-res files are resampled down to
/// keep memory and IPC transfer sizes reasonable; 48 kHz is transparent.
pub const MAX_INTERNAL_RATE: u32 = 48_000;

pub fn ffmpeg_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for name in ["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe", "ffmpeg"] {
                    let candidate = dir.join(name);
                    if candidate.is_file() {
                        return candidate;
                    }
                }
            }
        }
        // Development fallback: the sidecar inside the source tree, then PATH.
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("ffmpeg-x86_64-pc-windows-msvc.exe");
        if dev.is_file() {
            return dev;
        }
        PathBuf::from("ffmpeg")
    })
    .clone()
}

pub fn command() -> Command {
    let mut cmd = Command::new(ffmpeg_path());
    cmd.arg("-nostdin").arg("-hide_banner").arg("-y");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub channel_layout: String,
    pub duration: f64,
    pub bitrate_kbps: Option<u32>,
}

/// Probe a file by parsing `ffmpeg -i` output (avoids bundling ffprobe too).
pub fn probe(path: &Path) -> Result<ProbeInfo, String> {
    let mut cmd = command();
    cmd.arg("-i").arg(path);
    let out = cmd
        .output()
        .map_err(|e| format!("Could not start FFmpeg ({}): {e}", ffmpeg_path().display()))?;
    let text = String::from_utf8_lossy(&out.stderr);

    static DUR: OnceLock<Regex> = OnceLock::new();
    static AUDIO: OnceLock<Regex> = OnceLock::new();
    static BITRATE: OnceLock<Regex> = OnceLock::new();
    let dur_re = DUR.get_or_init(|| Regex::new(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)").unwrap());
    let audio_re = AUDIO.get_or_init(|| {
        Regex::new(r"Stream #\d+:\d+[^:]*: Audio: ([A-Za-z0-9_]+)[^,\n]*, (\d+) Hz, ([^,\n]+)").unwrap()
    });
    let br_re = BITRATE.get_or_init(|| Regex::new(r"bitrate: (\d+) kb/s").unwrap());

    let caps = audio_re
        .captures(&text)
        .ok_or_else(|| "No audio stream found in this file (is it a supported audio format?)".to_string())?;
    let codec = caps[1].to_string();
    let sample_rate: u32 = caps[2].parse().unwrap_or(44_100);
    let layout = caps[3].trim().to_string();
    let channels = match layout.as_str() {
        "mono" => 1,
        "stereo" => 2,
        l if l.starts_with("5.1") => 6,
        l if l.starts_with("7.1") => 8,
        l => l
            .split_whitespace()
            .next()
            .and_then(|n| n.trim_end_matches("channels").parse().ok())
            .unwrap_or(2),
    };
    let duration = dur_re
        .captures(&text)
        .map(|c| {
            c[1].parse::<f64>().unwrap_or(0.0) * 3600.0
                + c[2].parse::<f64>().unwrap_or(0.0) * 60.0
                + c[3].parse::<f64>().unwrap_or(0.0)
        })
        .unwrap_or(0.0);
    let bitrate_kbps = br_re.captures(&text).and_then(|c| c[1].parse().ok());
    Ok(ProbeInfo { codec, sample_rate, channels, channel_layout: layout, duration, bitrate_kbps })
}

fn run_checked(mut cmd: Command, what: &str) -> Result<(), String> {
    let out = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = err.lines().rev().take(6).collect();
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        return Err(format!("{what} failed: {}", tail.join(" | ")));
    }
    Ok(())
}

/// Decode any input to raw interleaved stereo float32 PCM.
pub fn decode_to_f32(input: &Path, output: &Path, rate: u32) -> Result<(), String> {
    let mut cmd = command();
    cmd.arg("-i")
        .arg(input)
        .args(["-vn", "-map", "0:a:0", "-ac", "2", "-ar"])
        .arg(rate.to_string())
        .args(["-c:a", "pcm_f32le", "-f", "f32le"])
        .arg(output);
    run_checked(cmd, "Decoding")
}

/// Rubber Band time-stretch / pitch-shift of raw stereo f32 PCM.
pub fn rubberband(input: &Path, output: &Path, rate: u32, tempo: f64, pitch: f64, high_quality: bool) -> Result<(), String> {
    let filter = format!(
        "rubberband=tempo={tempo:.6}:pitch={pitch:.6}:transients=mixed:detector=compound:phase=laminar:window=standard:smoothing=off:formant=shifted:pitchq={}:channels=together",
        if high_quality { "quality" } else { "speed" }
    );
    let mut cmd = command();
    cmd.args(["-f", "f32le", "-ar"])
        .arg(rate.to_string())
        .args(["-ac", "2", "-i"])
        .arg(input)
        .args(["-af", &filter, "-c:a", "pcm_f32le", "-f", "f32le"])
        .arg(output);
    run_checked(cmd, "Time-stretch")
}

pub struct EncodeSpec<'a> {
    pub format: &'a str,
    pub quality: &'a str,
    pub in_rate: u32,
    pub out_rate: u32,
    pub title: Option<&'a str>,
}

fn codec_args(spec: &EncodeSpec) -> Result<Vec<String>, String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    Ok(match spec.format {
        "mp3" => {
            let mut a = s(&["-c:a", "libmp3lame", "-id3v2_version", "3"]);
            match spec.quality {
                "v0" => a.extend(s(&["-q:a", "0"])),
                kbps => {
                    let k: u32 = kbps.parse().map_err(|_| format!("Invalid MP3 bitrate '{kbps}'"))?;
                    if !(32..=320).contains(&k) {
                        return Err(format!("MP3 bitrate must be between 32 and 320 kbps (got {k})"));
                    }
                    a.extend(s(&["-b:a", &format!("{k}k")]));
                }
            }
            a.extend(s(&["-f", "mp3"]));
            a
        }
        "wav" => {
            let codec = match spec.quality {
                "16" => "pcm_s16le",
                "24" => "pcm_s24le",
                "32f" => "pcm_f32le",
                q => return Err(format!("Invalid WAV bit depth '{q}'")),
            };
            s(&["-c:a", codec, "-f", "wav"])
        }
        "flac" => {
            let mut a = s(&["-c:a", "flac", "-compression_level", "8"]);
            match spec.quality {
                "16" => a.extend(s(&["-sample_fmt", "s16"])),
                "24" => a.extend(s(&["-sample_fmt", "s32", "-bits_per_raw_sample", "24"])),
                q => return Err(format!("Invalid FLAC bit depth '{q}'")),
            }
            a.extend(s(&["-f", "flac"]));
            a
        }
        f => return Err(format!("Unsupported export format '{f}'")),
    })
}

/// Encode raw stereo f32 PCM into the target format, reporting progress 0..1.
pub fn encode(
    input: &Path,
    output: &Path,
    spec: &EncodeSpec,
    total_seconds: f64,
    mut on_progress: impl FnMut(f64),
) -> Result<(), String> {
    let mut cmd = command();
    cmd.args(["-f", "f32le", "-ar"])
        .arg(spec.in_rate.to_string())
        .args(["-ac", "2", "-i"])
        .arg(input)
        .args(["-map_metadata", "-1"]);
    if spec.out_rate != spec.in_rate {
        cmd.args(["-af", "aresample=resampler=soxr:precision=28"]).arg("-ar").arg(spec.out_rate.to_string());
    }
    if let Some(t) = spec.title {
        cmd.arg("-metadata").arg(format!("title={t}"));
    }
    cmd.args(codec_args(spec)?);
    cmd.args(["-progress", "pipe:1", "-nostats"]).arg(output);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    let stderr = child.stderr.take();
    let err_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut buf);
        }
        buf
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(us) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = us.trim().parse::<f64>() {
                    if total_seconds > 0.0 {
                        on_progress((us / 1e6 / total_seconds).clamp(0.0, 1.0));
                    }
                }
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let err = err_thread.join().unwrap_or_default();
    if !status.success() {
        let tail: Vec<&str> = err.lines().rev().take(6).collect();
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        return Err(format!("Encoding failed: {}", tail.join(" | ")));
    }
    on_progress(1.0);
    Ok(())
}

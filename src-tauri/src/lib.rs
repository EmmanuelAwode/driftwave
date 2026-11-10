mod ffmpeg;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

const SUPPORTED_EXT: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "aac", "oga", "opus", "wave", "aif", "aiff"];

#[derive(Clone)]
struct Track {
    raw: PathBuf,
    rate: u32,
}

#[derive(Default)]
struct AppState {
    tracks: Mutex<HashMap<String, Track>>,
    next_id: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackInfo {
    id: String,
    path: String,
    name: String,
    format: String,
    codec: String,
    source_sample_rate: u32,
    sample_rate: u32,
    source_channels: u32,
    channel_layout: String,
    duration: f64,
    size_bytes: u64,
    bitrate_kbps: Option<u32>,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("work");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    async move {
        tauri::async_runtime::spawn_blocking(f)
            .await
            .map_err(|e| format!("Worker failed: {e}"))?
    }
}

/// Probe + decode a local file into the work cache. The original is only read.
#[tauri::command]
async fn import_audio(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<TrackInfo, String> {
    let src = PathBuf::from(&path);
    let meta = std::fs::metadata(&src).map_err(|e| format!("Cannot open file: {e}"))?;
    if !meta.is_file() {
        return Err("That path is not a file".into());
    }
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !SUPPORTED_EXT.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type '.{ext}'. Supported: MP3, WAV, FLAC, M4A, OGG, AAC."));
    }
    let id = format!("t{}", state.next_id.fetch_add(1, Ordering::SeqCst));
    let raw = cache_dir(&app)?.join(format!("{id}.f32"));

    let (probe, rate, raw) = blocking({
        let src = src.clone();
        move || {
            let probe = ffmpeg::probe(&src)?;
            let rate = probe.sample_rate.clamp(8_000, ffmpeg::MAX_INTERNAL_RATE);
            ffmpeg::decode_to_f32(&src, &raw, rate)?;
            Ok((probe, rate, raw))
        }
    })
    .await?;

    let bytes = std::fs::metadata(&raw).map(|m| m.len()).unwrap_or(0);
    if bytes == 0 {
        return Err("The file decoded to no audio samples".into());
    }
    let duration = bytes as f64 / 8.0 / rate as f64;
    state.tracks.lock().unwrap().insert(id.clone(), Track { raw, rate });

    Ok(TrackInfo {
        id,
        name: src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path,
        format: ext.to_uppercase(),
        codec: probe.codec,
        source_sample_rate: probe.sample_rate,
        sample_rate: rate,
        source_channels: probe.channels,
        channel_layout: probe.channel_layout,
        duration,
        size_bytes: meta.len(),
        bitrate_kbps: probe.bitrate_kbps,
    })
}

fn track(state: &State<'_, AppState>, id: &str) -> Result<Track, String> {
    state
        .tracks
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "Track is no longer loaded".to_string())
}

/// Raw interleaved stereo float32 PCM of a decoded track.
#[tauri::command]
async fn get_pcm(state: State<'_, AppState>, id: String) -> Result<Response, String> {
    let t = track(&state, &id)?;
    let data = blocking(move || std::fs::read(&t.raw).map_err(|e| e.to_string())).await?;
    Ok(Response::new(data))
}

/// Rubber Band render: returns stretched/pitch-shifted stereo f32 PCM.
/// Results are cached on disk keyed by parameters so toggling back is instant.
#[tauri::command]
async fn render_stretch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    tempo: f64,
    pitch: f64,
    high_quality: bool,
) -> Result<Response, String> {
    if !(0.2..=2.5).contains(&tempo) || !(0.2..=5.0).contains(&pitch) {
        return Err("Tempo or pitch out of range".into());
    }
    let t = track(&state, &id)?;
    let key = format!("{id}-{tempo:.4}-{pitch:.6}-{high_quality}");
    let hash = hex::encode(&Sha256::digest(key.as_bytes())[..8]);
    let out = cache_dir(&app)?.join(format!("{id}-rb-{hash}.f32"));
    let data = blocking(move || {
        if !out.is_file() {
            let tmp = out.with_extension("part");
            ffmpeg::rubberband(&t.raw, &tmp, t.rate, tempo, pitch, high_quality)?;
            std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
        }
        std::fs::read(&out).map_err(|e| e.to_string())
    })
    .await?;
    Ok(Response::new(data))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    stage: &'static str,
    progress: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    size_bytes: u64,
}

fn header<'a>(req: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Missing header {name}"))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Encode the rendered (processed) mix. Body: interleaved stereo f32 PCM.
#[tauri::command]
async fn export_audio(app: AppHandle, request: Request<'_>) -> Result<ExportResult, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Expected raw PCM body".into());
    };
    if body.is_empty() || body.len() % 8 != 0 {
        return Err("Rendered audio is empty or malformed".into());
    }
    let out_path = PathBuf::from(percent_decode(header(&request, "x-out-path")?));
    let format = header(&request, "x-format")?.to_string();
    let quality = header(&request, "x-quality")?.to_string();
    let in_rate: u32 = header(&request, "x-sample-rate")?.parse().map_err(|_| "Bad sample rate")?;
    let out_rate: u32 = header(&request, "x-out-rate")?.parse().map_err(|_| "Bad output rate")?;
    let title = percent_decode(header(&request, "x-title").unwrap_or(""));

    let parent = out_path.parent().ok_or("Invalid output path")?;
    if !parent.is_dir() {
        return Err(format!("Output folder does not exist: {}", parent.display()));
    }
    let total = body.len() as f64 / 8.0 / in_rate as f64;
    let tmp_in = cache_dir(&app)?.join(format!("export-{}.f32", std::process::id()));
    std::fs::write(&tmp_in, body).map_err(|e| format!("Could not write temp audio: {e}"))?;

    let app2 = app.clone();
    let result = blocking(move || {
        let ext = out_path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        let tmp_out = out_path.with_extension(format!("partial.{ext}"));
        let spec = ffmpeg::EncodeSpec {
            format: &format,
            quality: &quality,
            in_rate,
            out_rate,
            title: if title.is_empty() { None } else { Some(&title) },
        };
        let mut last = -1.0;
        let res = ffmpeg::encode(&tmp_in, &tmp_out, &spec, total, |p| {
            if p - last >= 0.01 || p >= 1.0 {
                last = p;
                let _ = app2.emit("export-progress", ExportProgress { stage: "encoding", progress: p });
            }
        });
        let _ = std::fs::remove_file(&tmp_in);
        if let Err(e) = res {
            let _ = std::fs::remove_file(&tmp_out);
            return Err(e);
        }
        if out_path.exists() {
            std::fs::remove_file(&out_path).map_err(|e| format!("Cannot overwrite existing file: {e}"))?;
        }
        std::fs::rename(&tmp_out, &out_path).map_err(|e| e.to_string())?;
        let size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        Ok(ExportResult { path: out_path.to_string_lossy().to_string(), size_bytes: size })
    })
    .await?;
    Ok(result)
}

#[tauri::command]
fn release_track(app: AppHandle, state: State<'_, AppState>, id: String) {
    state.tracks.lock().unwrap().remove(&id);
    if let Ok(dir) = cache_dir(&app) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name == format!("{id}.f32") || name.starts_with(&format!("{id}-")) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
    }
}

fn presets_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("user-presets.json"))
}

#[tauri::command]
fn load_user_data(app: AppHandle) -> Result<String, String> {
    let f = presets_file(&app)?;
    if !f.is_file() {
        return Ok("{}".into());
    }
    std::fs::read_to_string(f).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_user_data(app: AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Invalid data: {e}"))?;
    let f = presets_file(&app)?;
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, f).map_err(|e| e.to_string())
}

#[tauri::command]
fn default_export_dir(app: AppHandle) -> String {
    app.path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Open a project web page (only https://github.com links) in the default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") || url.contains('"') || url.contains(' ') {
        return Err("Refusing to open that link".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
fn engine_info() -> serde_json::Value {
    serde_json::json!({ "ffmpeg": ffmpeg::ffmpeg_path().to_string_lossy() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Clear leftover work files from previous sessions.
            if let Ok(dir) = cache_dir(app.handle()) {
                let _ = std::fs::remove_dir_all(&dir);
                let _ = std::fs::create_dir_all(&dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_audio,
            get_pcm,
            render_stretch,
            export_audio,
            release_track,
            load_user_data,
            save_user_data,
            default_export_dir,
            path_exists,
            reveal_path,
            open_url,
            engine_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Driftwave");
}

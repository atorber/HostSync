use aws_sdk_s3::Client as S3Client;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

mod config;
mod config_scan;
mod path_mapper;
mod s3;
mod skill;
mod store;

use config::load_config;
use config::HostSyncConfig;

static S3_CLIENT: RwLock<Option<(S3Client, HostSyncConfig)>> = RwLock::new(None);

fn get_client() -> Result<(S3Client, HostSyncConfig), String> {
    S3_CLIENT
        .read()
        .map_err(|_| "S3 客户端状态读取失败".to_string())?
        .clone()
        .ok_or_else(|| "配置未加载或无效".to_string())
}

fn reload_s3_client() -> Result<(), String> {
    let cfg = load_config().map_err(|e| e.to_string())?;
    let client = s3::create_client(&cfg).map_err(|e| e.to_string())?;
    let mut guard = S3_CLIENT
        .write()
        .map_err(|_| "S3 客户端状态写入失败".to_string())?;
    *guard = Some((client, cfg));
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HostsResponse {
    pub hosts: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct S3ObjectInfo {
    pub key: String,
    pub size: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilesResponse {
    pub host: String,
    pub objects: Vec<S3ObjectInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContentResponse {
    pub key: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInfoResponse {
    pub desktop: bool,
}

fn validate_remote_key(key: &str) -> bool {
    if key.is_empty() || key.contains('\\') || key.starts_with('/') || key.contains('\0') {
        return false;
    }
    if key.split('/').any(|p| p == "..") {
        return false;
    }
    key.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '~' || c == '%' || c == '-' || c == '/')
}

#[tauri::command]
fn auth_info() -> Result<AuthInfoResponse, String> {
    get_client()?;
    Ok(AuthInfoResponse { desktop: true })
}

#[tauri::command]
async fn hosts() -> Result<HostsResponse, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let objs = s3::list_all_objects(&client, &bucket, "").await.map_err(|e| e.to_string())?;
    let mut hosts: Vec<String> = objs
        .iter()
        .filter_map(|o| o.key.split('/').next().map(String::from))
        .filter(|h| !h.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    hosts.sort();
    Ok(HostsResponse { hosts })
}

#[tauri::command]
async fn files(host: String) -> Result<FilesResponse, String> {
    let host = host.trim().to_string();
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid host".to_string());
    }
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let prefix = format!("{}/", host);
    let objs = s3::list_all_objects(&client, &bucket, &prefix).await.map_err(|e| e.to_string())?;
    Ok(FilesResponse {
        host: host.clone(),
        objects: objs
            .into_iter()
            .map(|o| S3ObjectInfo {
                key: o.key,
                size: o.size,
                etag: o.etag,
                last_modified: o.last_modified,
            })
            .collect(),
    })
}

const MAX_PREVIEW_BYTES: usize = 512 * 1024;

#[tauri::command]
async fn file_content(key: String) -> Result<FileContentResponse, String> {
    if !validate_remote_key(&key) {
        return Err("invalid key".to_string());
    }
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let bytes = s3::get_object_bytes(&client, &bucket, &key).await.map_err(|e| e.to_string())?;
    if bytes.iter().any(|&b| b == 0) {
        return Err("binary file not supported".to_string());
    }
    let truncated = bytes.len() > MAX_PREVIEW_BYTES;
    let text = String::from_utf8_lossy(if truncated { &bytes[..MAX_PREVIEW_BYTES] } else { &bytes }).to_string();
    Ok(FileContentResponse {
        key,
        text,
        truncated,
    })
}

#[tauri::command]
async fn download_file(key: String) -> Result<(), String> {
    if !validate_remote_key(&key) {
        return Err("invalid key".to_string());
    }
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let bytes = s3::get_object_bytes(&client, &bucket, &key).await.map_err(|e| e.to_string())?;
    let filename = key.split('/').last().unwrap_or("download").to_string();
    if let Some(path) = rfd::FileDialog::new().set_file_name(&filename).save_file() {
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("用户取消保存".to_string())
    }
}

/// 初始化 S3 客户端（在应用启动时调用一次）
#[tauri::command]
fn init_s3() -> Result<(), String> {
    reload_s3_client()
}

#[tauri::command]
fn get_config_path() -> Result<String, String> {
    Ok(config::get_config_path().to_string_lossy().to_string())
}

// ---------- S3 配置（设置页读写） ----------
#[tauri::command]
fn config_load() -> Result<HostSyncConfig, String> {
    load_config().map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSyncConfigInput {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
    pub region: Option<String>,
    pub force_path_style: Option<bool>,
}

#[tauri::command]
fn config_save(input: HostSyncConfigInput) -> Result<(), String> {
    let cfg = HostSyncConfig {
        endpoint: input.endpoint,
        access_key: input.access_key,
        secret_key: input.secret_key,
        bucket: input.bucket,
        region: input.region,
        force_path_style: input.force_path_style,
    };
    config::save_config(&cfg).map_err(|e| e.to_string())?;
    let client = s3::create_client(&cfg).map_err(|e| e.to_string())?;
    let mut guard = S3_CLIENT
        .write()
        .map_err(|_| "S3 客户端状态写入失败".to_string())?;
    *guard = Some((client, cfg));
    Ok(())
}

// ---------- API 管理 ----------
#[tauri::command]
fn api_list() -> Result<Vec<store::ApiKeyEntry>, String> {
    store::api_keys_load()
}

#[tauri::command]
fn api_get(id: String) -> Result<Option<store::ApiKeyEntry>, String> {
    store::api_key_get(&id)
}

#[tauri::command]
fn api_create(
    name: String,
    kind: String,
    api_key: String,
    base_url: Option<String>,
    remark: Option<String>,
) -> Result<store::ApiKeyEntry, String> {
    store::api_key_create(name, kind, api_key, base_url, remark)
}

#[tauri::command]
fn api_update(
    id: String,
    name: Option<String>,
    kind: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    remark: Option<String>,
) -> Result<store::ApiKeyEntry, String> {
    store::api_key_update(&id, name, kind, api_key, base_url, remark)
}

#[tauri::command]
fn api_delete(id: String) -> Result<(), String> {
    store::api_key_delete(&id)
}

// ---------- Skill 管理 ----------
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillScanProgress {
    dirs_scanned: u32,
    found_count: u32,
    current_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillScanComplete {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn skill_scan_roots(app: tauri::AppHandle, roots: Vec<String>) -> Result<(), String> {
    use std::path::Path;
    use std::thread;
    use tauri::Emitter;

    thread::spawn(move || {
        let app_progress = app.clone();
        let progress = skill::ScanProgress::new(move |dirs, found, path: &str| {
            let _ = app_progress.emit(
                "skill-scan-progress",
                SkillScanProgress {
                    dirs_scanned: dirs,
                    found_count: found,
                    current_path: path.to_string(),
                },
            );
        });

        let result = (|| -> Result<(), String> {
            let mut all = Vec::new();
            for r in &roots {
                let path = Path::new(r);
                if path.exists() {
                    let list = skill::scan_root(path, &progress)?;
                    all.push(list);
                }
            }
            let merged = skill::merge_scan_results(all);
            store::skill_index_merge_replace(merged)?;
            Ok(())
        })();

        let _ = app.emit(
            "skill-scan-complete",
            match &result {
                Ok(()) => SkillScanComplete {
                    success: true,
                    error: None,
                },
                Err(e) => SkillScanComplete {
                    success: false,
                    error: Some(e.clone()),
                },
            },
        );
    });

    Ok(())
}

#[tauri::command]
fn skill_list() -> Result<Vec<store::SkillIndexEntry>, String> {
    store::skills_index_load()
}

#[tauri::command]
fn skill_read_content(path: String) -> Result<String, String> {
    skill::skill_read_content(&path)
}

#[tauri::command]
fn skill_write_content(path: String, content: String) -> Result<(), String> {
    skill::skill_write_content(&path, &content)
}

// ---------- 配置管理（AI 工具配置扫描） ----------
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigScanProgress {
    current_tool: String,
    files_found: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigScanComplete {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<Vec<config_scan::ScannedConfigFile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn config_scan_project(project_root: String) -> Result<Vec<config_scan::ScannedConfigFile>, String> {
    let path = std::path::Path::new(&project_root);
    Ok(config_scan::scan_project(path))
}

#[tauri::command]
fn config_scan_home() -> Result<Vec<config_scan::ScannedConfigFile>, String> {
    Ok(config_scan::scan_home())
}

#[tauri::command]
fn config_scan_all(app: tauri::AppHandle, project_root: Option<String>) -> Result<(), String> {
    use std::thread;
    use tauri::Emitter;

    let root = project_root.clone();
    thread::spawn(move || {
        let app_progress = app.clone();
        let result = config_scan::scan_all_with_progress(
            root.as_deref().map(std::path::Path::new),
            |tool_name, files_found| {
                let _ = app_progress.emit(
                    "config-scan-progress",
                    ConfigScanProgress {
                        current_tool: tool_name.to_string(),
                        files_found,
                    },
                );
            },
        );
        let _ = app.emit(
            "config-scan-complete",
            ConfigScanComplete {
                success: true,
                files: Some(result),
                error: None,
            },
        );
    });
    Ok(())
}

#[tauri::command]
fn config_read_file(abs_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&abs_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn config_write_file(abs_path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&abs_path);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

// ---------- 配置文件推送 / 拉取（与 CLI push/pull 一致） ----------
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPushResult {
    pub abs_path: String,
    pub s3_key: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn config_push_files(abs_paths: Vec<String>) -> Result<Vec<ConfigPushResult>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let mut results = Vec::new();
    for abs in &abs_paths {
        let key = path_mapper::build_s3_key_for_file(abs);
        if !path_mapper::validate_remote_key(&key) {
            results.push(ConfigPushResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: false,
                error: Some("非法 S3 key".to_string()),
            });
            continue;
        }
        let content = match std::fs::read(abs) {
            Ok(c) => c,
            Err(e) => {
                results.push(ConfigPushResult {
                    abs_path: abs.clone(),
                    s3_key: key,
                    ok: false,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let ct = if abs.ends_with(".json") {
            "application/json"
        } else if abs.ends_with(".yml") || abs.ends_with(".yaml") {
            "text/yaml"
        } else if abs.ends_with(".toml") {
            "application/toml"
        } else if abs.ends_with(".md") {
            "text/markdown"
        } else {
            "text/plain"
        };
        match s3::put_object_bytes(&client, &bucket, &key, &content, ct).await {
            Ok(_) => results.push(ConfigPushResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: true,
                error: None,
            }),
            Err(e) => results.push(ConfigPushResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: false,
                error: Some(e.to_string()),
            }),
        }
    }
    Ok(results)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPullResult {
    pub abs_path: String,
    pub s3_key: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn config_pull_files(abs_paths: Vec<String>) -> Result<Vec<ConfigPullResult>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let mut results = Vec::new();
    for abs in &abs_paths {
        let key = path_mapper::build_s3_key_for_file(abs);
        if !path_mapper::validate_remote_key(&key) {
            results.push(ConfigPullResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: false,
                error: Some("非法 S3 key".to_string()),
            });
            continue;
        }
        let bytes = match s3::get_object_bytes(&client, &bucket, &key).await {
            Ok(b) => b,
            Err(e) => {
                results.push(ConfigPullResult {
                    abs_path: abs.clone(),
                    s3_key: key,
                    ok: false,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let path = std::path::Path::new(abs.as_str());
        if let Some(p) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(p) {
                results.push(ConfigPullResult {
                    abs_path: abs.clone(),
                    s3_key: key,
                    ok: false,
                    error: Some(e.to_string()),
                });
                continue;
            }
        }
        match std::fs::write(path, &bytes) {
            Ok(_) => results.push(ConfigPullResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: true,
                error: None,
            }),
            Err(e) => results.push(ConfigPullResult {
                abs_path: abs.clone(),
                s3_key: key,
                ok: false,
                error: Some(e.to_string()),
            }),
        }
    }
    Ok(results)
}

#[tauri::command]
fn get_hostname() -> Result<String, String> {
    Ok(path_mapper::get_remote_prefix())
}

// ---------- 远端主机 / 文件浏览 / 跨主机拉取 ----------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteObject {
    pub key: String,
    pub size: Option<u64>,
    pub last_modified: Option<String>,
}

/// 列出 configs/ 下所有主机名
#[tauri::command]
async fn config_remote_hosts() -> Result<Vec<String>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let objs = s3::list_all_objects(&client, &bucket, "configs/")
        .await
        .map_err(|e| e.to_string())?;
    let mut hosts: Vec<String> = objs
        .iter()
        .filter_map(|o| {
            let rest = o.key.strip_prefix("configs/")?;
            let seg = rest.split('/').next()?;
            if seg.is_empty() { None } else { Some(seg.to_string()) }
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    hosts.sort();
    Ok(hosts)
}

/// 列出 configs/{host}/ 下的全部对象
#[tauri::command]
async fn config_remote_objects(host: String) -> Result<Vec<RemoteObject>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let prefix = format!("configs/{}/", host);
    let objs = s3::list_all_objects(&client, &bucket, &prefix)
        .await
        .map_err(|e| e.to_string())?;
    Ok(objs
        .into_iter()
        .map(|o| RemoteObject {
            key: o.key,
            size: o.size,
            last_modified: o.last_modified,
        })
        .collect())
}

/// 按目录拉取：给定 S3 key 列表 + 要剥离的公共前缀 + 本地目标目录
/// 把 key 去掉 strip_prefix 后的相对路径保存到 local_dir 下
#[tauri::command]
async fn config_pull_remote_dir(
    keys: Vec<String>,
    strip_prefix: String,
    local_dir: String,
) -> Result<Vec<ConfigPullResult>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let mut results = Vec::new();
    for key in &keys {
        let rel = if key.starts_with(&strip_prefix) {
            &key[strip_prefix.len()..]
        } else {
            key.as_str()
        };
        let rel_decoded = path_mapper::decode_relative_path(rel);
        let local_path = std::path::Path::new(&local_dir).join(&rel_decoded);
        let local_str = local_path.to_string_lossy().to_string();

        let bytes = match s3::get_object_bytes(&client, &bucket, key).await {
            Ok(b) => b,
            Err(e) => {
                results.push(ConfigPullResult {
                    abs_path: local_str,
                    s3_key: key.clone(),
                    ok: false,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        if let Some(p) = local_path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        match std::fs::write(&local_path, &bytes) {
            Ok(_) => results.push(ConfigPullResult {
                abs_path: local_str,
                s3_key: key.clone(),
                ok: true,
                error: None,
            }),
            Err(e) => results.push(ConfigPullResult {
                abs_path: local_str,
                s3_key: key.clone(),
                ok: false,
                error: Some(e.to_string()),
            }),
        }
    }
    Ok(results)
}

/// 按文件拉取：给定一个 S3 key + 本地保存路径
#[tauri::command]
async fn config_pull_remote_file(
    key: String,
    local_path: String,
) -> Result<ConfigPullResult, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let bytes = match s3::get_object_bytes(&client, &bucket, &key).await {
        Ok(b) => b,
        Err(e) => {
            return Ok(ConfigPullResult {
                abs_path: local_path,
                s3_key: key,
                ok: false,
                error: Some(e.to_string()),
            });
        }
    };
    let path = std::path::Path::new(&local_path);
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    match std::fs::write(path, &bytes) {
        Ok(_) => Ok(ConfigPullResult {
            abs_path: local_path,
            s3_key: key,
            ok: true,
            error: None,
        }),
        Err(e) => Ok(ConfigPullResult {
            abs_path: local_path,
            s3_key: key,
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---------- API Keys 同步到 S3 ----------
#[tauri::command]
async fn api_sync_to_cloud() -> Result<String, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let api_keys = store::api_keys_load()?;
    let json = serde_json::to_string_pretty(&api_keys).map_err(|e| e.to_string())?;
    let key = "sync/api-keys.json".to_string();
    s3::put_object_bytes(&client, &bucket, &key, json.as_bytes(), "application/json")
        .await
        .map_err(|e| e.to_string())?;
    Ok(key)
}

#[tauri::command]
async fn api_pull_from_cloud() -> Result<Vec<store::ApiKeyEntry>, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let key = "sync/api-keys.json";
    let bytes = s3::get_object_bytes(&client, &bucket, key)
        .await
        .map_err(|e| e.to_string())?;
    let remote: Vec<store::ApiKeyEntry> =
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    store::api_keys_save(remote.clone())?;
    Ok(remote)
}

// ---------- 一键备份到 S3 ----------
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BackupPayload {
    #[serde(rename = "apiKeys")]
    api_keys: Vec<store::ApiKeyEntry>,
    #[serde(rename = "skills")]
    skills: Vec<store::SkillIndexEntry>,
    #[serde(rename = "exportedAt")]
    exported_at: i64,
}

#[tauri::command]
async fn backup_run() -> Result<String, String> {
    let (client, cfg) = get_client()?;
    let bucket = cfg.bucket.clone();
    let api_keys = store::api_keys_load()?;
    let skills = store::skills_index_load()?;
    let payload = BackupPayload {
        api_keys,
        skills,
        exported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64,
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let key = format!("backup/backup-{}.json", payload.exported_at);
    s3::put_object_bytes(&client, &bucket, &key, json.as_bytes(), "application/json")
        .await
        .map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            init_s3,
            get_config_path,
            config_load,
            config_save,
            auth_info,
            hosts,
            files,
            file_content,
            download_file,
            api_list,
            api_get,
            api_create,
            api_update,
            api_delete,
            skill_scan_roots,
            skill_list,
            skill_read_content,
            skill_write_content,
            config_scan_project,
            config_scan_home,
            config_scan_all,
            config_read_file,
            config_write_file,
            config_push_files,
            config_pull_files,
            config_remote_hosts,
            config_remote_objects,
            config_pull_remote_dir,
            config_pull_remote_file,
            get_hostname,
            backup_run,
            api_sync_to_cloud,
            api_pull_from_cloud,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

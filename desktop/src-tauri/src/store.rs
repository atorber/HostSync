// 本地存储：API Keys 等，JSON 文件存于 config 目录
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::config::get_config_dir;

const API_KEYS_FILE: &str = "api-keys.json";
const SKILLS_INDEX_FILE: &str = "skills-index.json";

fn api_keys_path() -> PathBuf {
    get_config_dir().join(API_KEYS_FILE)
}

fn skills_index_path() -> PathBuf {
    get_config_dir().join(SKILLS_INDEX_FILE)
}

// ---------- API Keys ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyEntry {
    pub id: String,
    pub name: String,
    /// 如 openai, anthropic, custom
    pub kind: String,
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub remark: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ApiKeysStore {
    #[serde(default)]
    entries: Vec<ApiKeyEntry>,
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn new_id() -> String {
    format!("api_{}", now_ts())
}

pub fn api_keys_load() -> Result<Vec<ApiKeyEntry>, String> {
    let path = api_keys_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let store: ApiKeysStore = serde_json::from_str(&raw).unwrap_or_default();
    Ok(store.entries)
}

pub fn api_keys_save(entries: Vec<ApiKeyEntry>) -> Result<(), String> {
    let dir = get_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let store = ApiKeysStore { entries };
    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    std::fs::write(api_keys_path(), json + "\n").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn api_key_create(
    name: String,
    kind: String,
    api_key: String,
    base_url: Option<String>,
    remark: Option<String>,
    model: Option<String>,
) -> Result<ApiKeyEntry, String> {
    let mut entries = api_keys_load()?;
    let now = now_ts();
    let id = new_id();
    let entry = ApiKeyEntry {
        id: id.clone(),
        name,
        kind,
        api_key,
        base_url,
        remark,
        model,
        created_at: now,
        updated_at: now,
    };
    entries.push(entry.clone());
    api_keys_save(entries)?;
    Ok(entry)
}

pub fn api_key_update(
    id: &str,
    name: Option<String>,
    kind: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    remark: Option<String>,
    model: Option<String>,
) -> Result<ApiKeyEntry, String> {
    let mut entries = api_keys_load()?;
    let pos = entries.iter().position(|e| e.id == id).ok_or("未找到该记录")?;
    let now = now_ts();
    let e = &mut entries[pos];
    if let Some(n) = name {
        e.name = n;
    }
    if let Some(k) = kind {
        e.kind = k;
    }
    if let Some(ak) = api_key {
        e.api_key = ak;
    }
    if let Some(u) = base_url {
        e.base_url = if u.is_empty() { None } else { Some(u) };
    }
    if let Some(r) = remark {
        e.remark = if r.is_empty() { None } else { Some(r) };
    }
    if let Some(m) = model {
        e.model = if m.is_empty() { None } else { Some(m) };
    }
    e.updated_at = now;
    let out = e.clone();
    api_keys_save(entries)?;
    Ok(out)
}

pub fn api_key_delete(id: &str) -> Result<(), String> {
    let mut entries = api_keys_load()?;
    entries.retain(|e| e.id != id);
    api_keys_save(entries)?;
    Ok(())
}

pub fn api_key_get(id: &str) -> Result<Option<ApiKeyEntry>, String> {
    let entries = api_keys_load()?;
    Ok(entries.into_iter().find(|e| e.id == id))
}

// ---------- Skills index (metadata only; content lives in files) ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillIndexEntry {
    pub id: String,
    /// 扫描根目录
    pub root_dir: String,
    /// 含 skill.md 的目录相对 root_dir 的路径，或绝对路径（兼容）
    pub dir_path: String,
    /// 显示名，默认目录名
    pub name: String,
    /// skill.md 的绝对路径
    pub skill_md_path: String,
    pub updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SkillsIndexStore {
    #[serde(default)]
    entries: Vec<SkillIndexEntry>,
}

pub fn skills_index_load() -> Result<Vec<SkillIndexEntry>, String> {
    let path = skills_index_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let store: SkillsIndexStore = serde_json::from_str(&raw).unwrap_or_default();
    Ok(store.entries)
}

pub fn skills_index_save(entries: Vec<SkillIndexEntry>) -> Result<(), String> {
    let dir = get_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let store = SkillsIndexStore { entries };
    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    std::fs::write(skills_index_path(), json + "\n").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn skill_index_merge_replace(new_entries: Vec<SkillIndexEntry>) -> Result<(), String> {
    skills_index_save(new_entries)
}

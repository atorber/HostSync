use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSyncConfig {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub force_path_style: Option<bool>,
}

pub fn get_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var("APPDATA").ok();
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        app_data
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("hostsync")
    }

    #[cfg(not(target_os = "windows"))]
    {
        dirs::config_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("hostsync")
    }
}

pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

pub fn load_config() -> Result<HostSyncConfig, Box<dyn std::error::Error + Send + Sync>> {
    let path = get_config_path();
    let raw = std::fs::read_to_string(&path)?;
    let parsed: HostSyncConfig = serde_json::from_str(&raw)?;
    if parsed.endpoint.is_empty()
        || parsed.access_key.is_empty()
        || parsed.secret_key.is_empty()
        || parsed.bucket.is_empty()
    {
        return Err(format!("配置不完整：{}", path.display()).into());
    }
    Ok(parsed)
}

pub fn save_config(cfg: &HostSyncConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let dir = get_config_dir();
    let path = get_config_path();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(cfg)?;
    std::fs::write(&path, json + "\n")?;
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(mut perms) = std::fs::metadata(&path).map(|m| m.permissions()) {
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&path, perms);
        }
    }
    Ok(())
}

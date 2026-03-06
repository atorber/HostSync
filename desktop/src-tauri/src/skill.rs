use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::store::SkillIndexEntry;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "target",
    "build",
    "dist",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".eggs",
    "Library",
    "Applications",
    "Music",
    "Movies",
    "Pictures",
    "Public",
];

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

fn name_contains_skill(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("skill")
}

fn is_text_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".txt")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".json")
        || lower.ends_with(".toml")
        || lower.ends_with(".conf")
        || lower.ends_with(".cfg")
        || lower.ends_with(".ini")
        || !lower.contains('.')
}

fn file_mtime(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct ScanProgress {
    dirs_scanned: AtomicU32,
    found_count: AtomicU32,
    on_progress: Box<dyn Fn(u32, u32, &str) + Send + Sync>,
}

impl ScanProgress {
    pub fn new(on_progress: impl Fn(u32, u32, &str) + Send + Sync + 'static) -> Self {
        Self {
            dirs_scanned: AtomicU32::new(0),
            found_count: AtomicU32::new(0),
            on_progress: Box::new(on_progress),
        }
    }

    fn tick_dir(&self, dir_path: &str) {
        let dirs = self.dirs_scanned.fetch_add(1, Ordering::Relaxed) + 1;
        let found = self.found_count.load(Ordering::Relaxed);
        if dirs % 20 == 0 || dirs <= 5 {
            (self.on_progress)(dirs, found, dir_path);
        }
    }

    fn tick_found(&self, file_path: &str) {
        let found = self.found_count.fetch_add(1, Ordering::Relaxed) + 1;
        let dirs = self.dirs_scanned.load(Ordering::Relaxed);
        (self.on_progress)(dirs, found, file_path);
    }

    fn emit_final(&self) {
        let dirs = self.dirs_scanned.load(Ordering::Relaxed);
        let found = self.found_count.load(Ordering::Relaxed);
        (self.on_progress)(dirs, found, "");
    }
}

pub fn scan_root(root: &Path, progress: &ScanProgress) -> Result<Vec<SkillIndexEntry>, String> {
    let mut results = Vec::new();
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let root_str = root.to_string_lossy().to_string();
    walk(&root, &root, &root_str, &mut results, 0, progress);
    progress.emit_final();
    Ok(results)
}

const MAX_DEPTH: u32 = 8;

fn walk(
    root: &Path,
    current: &Path,
    root_str: &str,
    out: &mut Vec<SkillIndexEntry>,
    depth: u32,
    progress: &ScanProgress,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let read_dir = match std::fs::read_dir(current) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    let display_path = current
        .strip_prefix(root)
        .unwrap_or(current)
        .to_string_lossy()
        .to_string();
    progress.tick_dir(&display_path);

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let is_dir = path.is_dir();
        let is_file = path.is_file();

        if is_dir {
            if should_skip_dir(&name) || name.starts_with('.') {
                if name_contains_skill(&name) {
                    collect_skill_files_in_dir(root, &path, root_str, &name, out, progress);
                }
                continue;
            }
            if name_contains_skill(&name) {
                collect_skill_files_in_dir(root, &path, root_str, &name, out, progress);
            }
            walk(root, &path, root_str, out, depth + 1, progress);
        } else if is_file && name_contains_skill(&name) && is_text_file(&name) {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let mtime = file_mtime(&path);
            let display = rel.clone();
            out.push(SkillIndexEntry {
                id: format!("skill_{}_{}", mtime, out.len()),
                root_dir: root_str.to_string(),
                dir_path: path
                    .parent()
                    .unwrap_or(&path)
                    .strip_prefix(root)
                    .unwrap_or(path.parent().unwrap_or(&path))
                    .to_string_lossy()
                    .replace('\\', "/"),
                name: display,
                skill_md_path: path.to_string_lossy().to_string(),
                updated_at: mtime,
            });
            progress.tick_found(&path.to_string_lossy());
        }
    }
}

fn collect_skill_files_in_dir(
    root: &Path,
    dir: &Path,
    root_str: &str,
    dir_display_name: &str,
    out: &mut Vec<SkillIndexEntry>,
    progress: &ScanProgress,
) {
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_text_file(&name) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let mtime = file_mtime(&path);
        out.push(SkillIndexEntry {
            id: format!("skill_{}_{}", mtime, out.len()),
            root_dir: root_str.to_string(),
            dir_path: dir_display_name.to_string(),
            name: rel.clone(),
            skill_md_path: path.to_string_lossy().to_string(),
            updated_at: mtime,
        });
        progress.tick_found(&path.to_string_lossy());
    }
}

pub fn merge_scan_results(scan_results: Vec<Vec<SkillIndexEntry>>) -> Vec<SkillIndexEntry> {
    let mut by_path: std::collections::HashMap<String, SkillIndexEntry> =
        std::collections::HashMap::new();
    for list in scan_results {
        for e in list {
            by_path.insert(e.skill_md_path.clone(), e);
        }
    }
    let mut v: Vec<SkillIndexEntry> = by_path.into_values().collect();
    v.sort_by(|a, b| a.skill_md_path.cmp(&b.skill_md_path));
    for (i, entry) in v.iter_mut().enumerate() {
        entry.id = format!("skill_{}_{}", entry.updated_at, i);
    }
    v
}

pub fn skill_read_content(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("文件不存在".to_string());
    }
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

pub fn skill_write_content(path: &str, content: &str) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

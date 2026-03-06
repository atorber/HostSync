// AI 工具配置扫描：与 CLI scanner 对齐的规则，在指定根目录下探测文件
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedConfigFile {
    pub tool: String,
    pub scope: String, // "project" | "home"
    pub rel_path: String,
    pub abs_path: String,
    pub size: u64,
    pub mtime: i64,
}

struct ToolRule {
    name: &'static str,
    scope: &'static str,
    files: &'static [&'static str],
    dirs: &'static [&'static str],
}

// 项目级规则（与 cli scanner PROJECT_TOOLS 对齐）
const PROJECT_RULES: &[ToolRule] = &[
    ToolRule {
        name: "Claude Code",
        scope: "project",
        files: &["CLAUDE.md", "CLAUDE.local.md", ".claude/settings.json", ".claude/settings.local.json"],
        dirs: &[".claude"],
    },
    ToolRule {
        name: "Codex (OpenAI)",
        scope: "project",
        files: &["AGENTS.md", "AGENTS.override.md"],
        dirs: &[],
    },
    ToolRule {
        name: "Cursor",
        scope: "project",
        files: &[".cursorrules"],
        dirs: &[".cursor"],
    },
    ToolRule {
        name: "GitHub Copilot",
        scope: "project",
        files: &[".github/copilot-instructions.md"],
        dirs: &[".github/instructions"],
    },
    ToolRule {
        name: "Windsurf",
        scope: "project",
        files: &[".windsurfrules"],
        dirs: &[".windsurf/rules"],
    },
    ToolRule {
        name: "Aider",
        scope: "project",
        files: &[".aider.conf.yml", "CONVENTIONS.md", ".aider.env"],
        dirs: &[],
    },
    ToolRule {
        name: "Continue.dev",
        scope: "project",
        files: &[".continuerc.json"],
        dirs: &[".continue/rules"],
    },
    ToolRule {
        name: "Cline",
        scope: "project",
        files: &[],
        dirs: &[".clinerules"],
    },
    ToolRule {
        name: "Gemini",
        scope: "project",
        files: &["GEMINI.md"],
        dirs: &[],
    },
    ToolRule {
        name: "Zed",
        scope: "project",
        files: &[".rules"],
        dirs: &[],
    },
    ToolRule {
        name: "OpenClaw",
        scope: "project",
        files: &[".openclaw/rules.md", ".openclaw/config.json"],
        dirs: &[".openclaw"],
    },
];

// 用户主目录规则
const HOME_RULES: &[ToolRule] = &[
    ToolRule {
        name: "Claude Code",
        scope: "home",
        files: &[".claude/settings.json", ".claude/CLAUDE.md"],
        dirs: &[],
    },
    ToolRule {
        name: "Aider",
        scope: "home",
        files: &[".aider.conf.yml"],
        dirs: &[],
    },
    ToolRule {
        name: "Continue.dev",
        scope: "home",
        files: &[".continue/config.yaml", ".continue/config.json"],
        dirs: &[],
    },
    ToolRule {
        name: "Codex (OpenAI)",
        scope: "home",
        files: &[".codex/config.toml"],
        dirs: &[],
    },
    ToolRule {
        name: "Gemini",
        scope: "home",
        files: &[".gemini/GEMINI.md", ".gemini/settings.json"],
        dirs: &[],
    },
    ToolRule {
        name: "Cursor",
        scope: "home",
        files: &[],
        dirs: &[".cursor"],
    },
    ToolRule {
        name: "OpenClaw",
        scope: "home",
        files: &[".openclaw/rules.md", ".openclaw/config.json"],
        dirs: &[".openclaw"],
    },
];

fn path_to_posix(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn probe_file(root: &Path, rel: &str) -> Option<(PathBuf, u64, i64)> {
    let full = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let meta = std::fs::metadata(&full).ok()?;
    if meta.is_file() {
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        return Some((full, meta.len(), mtime));
    }
    None
}

fn collect_dir(root: &Path, dir_rel: &str, out: &mut Vec<(PathBuf, String, u64, i64)>) {
    let dir_full = root.join(dir_rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !dir_full.is_dir() {
        return;
    }
    if let Ok(rd) = std::fs::read_dir(&dir_full) {
        for e in rd.flatten() {
            let path = e.path();
            if e.metadata().map(|m| m.is_symlink()).unwrap_or(false) {
                continue;
            }
            if path.is_dir() {
                let sub_rel = path.strip_prefix(root).map(|p| path_to_posix(p)).unwrap_or_default();
                collect_dir(root, &sub_rel, out);
            } else if path.is_file() {
                let rel = path.strip_prefix(root).map(|p| path_to_posix(p)).unwrap_or_else(|_| path_to_posix(&path));
                let len = e.metadata().map(|m| m.len()).unwrap_or(0);
                let mtime = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
                out.push((path, rel, len, mtime));
            }
        }
    }
}

fn scan_tool(root: &Path, tool: &ToolRule) -> Vec<ScannedConfigFile> {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();

    for rel in tool.files {
        if let Some((abs, size, mtime)) = probe_file(root, rel) {
            let abs_s = path_to_posix(&abs);
            if seen.insert(abs_s.clone()) {
                files.push(ScannedConfigFile {
                    tool: tool.name.to_string(),
                    scope: tool.scope.to_string(),
                    rel_path: rel.to_string(),
                    abs_path: abs_s,
                    size,
                    mtime,
                });
            }
        }
    }
    for dir_rel in tool.dirs {
        let mut list = Vec::new();
        collect_dir(root, dir_rel, &mut list);
        for (abs, rel, size, mtime) in list {
            let abs_s = path_to_posix(&abs);
            if seen.insert(abs_s.clone()) {
                files.push(ScannedConfigFile {
                    tool: tool.name.to_string(),
                    scope: tool.scope.to_string(),
                    rel_path: rel,
                    abs_path: abs_s,
                    size,
                    mtime,
                });
            }
        }
    }
    files
}

/// 扫描项目目录（传入根路径）
pub fn scan_project(root: &Path) -> Vec<ScannedConfigFile> {
    let mut out = Vec::new();
    for tool in PROJECT_RULES {
        out.extend(scan_tool(root, tool));
    }
    out
}

/// 扫描用户主目录
pub fn scan_home() -> Vec<ScannedConfigFile> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut out = Vec::new();
    for tool in HOME_RULES {
        out.extend(scan_tool(&home, tool));
    }
    out
}

/// 扫描项目 + 主目录
pub fn scan_all(project_root: Option<&Path>) -> Vec<ScannedConfigFile> {
    let mut out = Vec::new();
    if let Some(root) = project_root {
        out.extend(scan_project(root));
    }
    out.extend(scan_home());
    out
}

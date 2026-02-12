import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ToolConfig {
  /** 工具显示名称，如 "Claude Code" */
  name: string;
  /** 文件或目录路径（相对于扫描根目录），不是 glob，直接 stat 检测 */
  files: string[];
  /** 需要递归展开的目录路径（相对于扫描根目录） */
  dirs: string[];
  /** 扫描范围 */
  scope: 'project' | 'home' | 'both';
  /** 配置格式说明 */
  format: string;
}

export interface ScannedFile {
  /** 相对于扫描根目录的 POSIX 路径 */
  relPath: string;
  /** 绝对路径 */
  absPath: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 最后修改时间 */
  mtime: Date;
}

export interface ScanResult {
  /** 工具名称 */
  tool: string;
  /** 扫描范围标识 */
  scope: 'project' | 'home';
  /** 发现的文件列表 */
  files: ScannedFile[];
}

/* ------------------------------------------------------------------ */
/*  AI Tool Registry                                                   */
/* ------------------------------------------------------------------ */

/**
 * 项目级工具配置注册表
 *
 * - `files`: 精确文件路径（相对于项目根目录），直接 stat 判断
 * - `dirs`:  目录路径，会递归收集其下所有普通文件
 */
const PROJECT_TOOLS: ToolConfig[] = [
  {
    name: 'Claude Code',
    files: ['CLAUDE.md', 'CLAUDE.local.md', '.claude/settings.json', '.claude/settings.local.json'],
    dirs: ['.claude'],
    scope: 'project',
    format: 'Markdown / JSON',
  },
  {
    name: 'Codex (OpenAI)',
    files: ['AGENTS.md', 'AGENTS.override.md'],
    dirs: [],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Cursor',
    files: ['.cursorrules'],
    dirs: ['.cursor/rules'],
    scope: 'project',
    format: 'Markdown / MDC',
  },
  {
    name: 'GitHub Copilot',
    files: ['.github/copilot-instructions.md'],
    dirs: ['.github/instructions'],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Windsurf',
    files: ['.windsurfrules'],
    dirs: ['.windsurf/rules'],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Aider',
    files: ['.aider.conf.yml', 'CONVENTIONS.md', '.aider.env'],
    dirs: [],
    scope: 'project',
    format: 'YAML / Markdown / Env',
  },
  {
    name: 'Continue.dev',
    files: ['.continuerc.json'],
    dirs: ['.continue/rules'],
    scope: 'project',
    format: 'JSON / Markdown',
  },
  {
    name: 'Cline',
    files: [],
    dirs: ['.clinerules'],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Gemini',
    files: ['GEMINI.md'],
    dirs: [],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Zed',
    files: ['.rules'],
    dirs: [],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'JetBrains Junie',
    files: ['.junie/guidelines.md'],
    dirs: [],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Amazon Q',
    files: [],
    dirs: ['.amazonq/rules'],
    scope: 'project',
    format: 'Markdown',
  },
  {
    name: 'Roo Code',
    files: ['.roorules', '.roomodes'],
    dirs: ['.roo'],
    scope: 'project',
    format: 'Markdown / JSON',
  },
  {
    name: 'Augment',
    files: [],
    dirs: ['.augment'],
    scope: 'project',
    format: 'Markdown',
  },
];

/**
 * 全局（用户主目录）工具配置注册表
 */
const HOME_TOOLS: ToolConfig[] = [
  {
    name: 'Claude Code',
    files: ['.claude/settings.json', '.claude/CLAUDE.md'],
    dirs: [],
    scope: 'home',
    format: 'JSON / Markdown',
  },
  {
    name: 'Aider',
    files: ['.aider.conf.yml'],
    dirs: [],
    scope: 'home',
    format: 'YAML',
  },
  {
    name: 'Continue.dev',
    files: ['.continue/config.yaml', '.continue/config.json'],
    dirs: [],
    scope: 'home',
    format: 'YAML / JSON',
  },
  {
    name: 'Codex (OpenAI)',
    files: ['.codex/config.toml'],
    dirs: [],
    scope: 'home',
    format: 'TOML',
  },
  {
    name: 'Gemini',
    files: ['.gemini/GEMINI.md', '.gemini/settings.json'],
    dirs: [],
    scope: 'home',
    format: 'Markdown / JSON',
  },
];

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/** 递归列出目录下所有普通文件（跳过符号链接） */
async function collectFilesInDir(
  rootDir: string,
  dirAbs: string,
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];

  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out; // 目录不存在或无权限
  }

  for (const ent of entries) {
    const absPath = path.join(dirAbs, ent.name);

    // 跳过符号链接
    let lst;
    try {
      lst = await fs.lstat(absPath);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) continue;

    if (ent.isDirectory()) {
      const children = await collectFilesInDir(rootDir, absPath);
      out.push(...children);
      continue;
    }

    if (ent.isFile()) {
      const relPath = path.relative(rootDir, absPath).split(path.sep).join('/');
      out.push({
        relPath,
        absPath,
        size: lst.size,
        mtime: lst.mtime,
      });
    }
  }

  return out;
}

/** 检查单个文件是否存在，返回 ScannedFile 或 null */
async function probeFile(rootDir: string, relPosix: string): Promise<ScannedFile | null> {
  const absPath = path.join(rootDir, ...relPosix.split('/'));
  try {
    const lst = await fs.lstat(absPath);
    if (lst.isSymbolicLink() || !lst.isFile()) return null;
    return {
      relPath: relPosix,
      absPath,
      size: lst.size,
      mtime: lst.mtime,
    };
  } catch {
    return null;
  }
}

/** 对某个 ToolConfig 在指定根目录下扫描 */
async function scanToolInDir(
  tool: ToolConfig,
  rootDir: string,
  scope: 'project' | 'home',
): Promise<ScanResult | null> {
  const seenPaths = new Set<string>();
  const files: ScannedFile[] = [];

  // 1. 精确文件探测
  for (const rel of tool.files) {
    const found = await probeFile(rootDir, rel);
    if (found && !seenPaths.has(found.absPath)) {
      seenPaths.add(found.absPath);
      files.push(found);
    }
  }

  // 2. 目录递归展开
  for (const dirRel of tool.dirs) {
    const dirAbs = path.join(rootDir, ...dirRel.split('/'));
    const children = await collectFilesInDir(rootDir, dirAbs);
    for (const f of children) {
      if (!seenPaths.has(f.absPath)) {
        seenPaths.add(f.absPath);
        files.push(f);
      }
    }
  }

  if (files.length === 0) return null;

  return { tool: tool.name, scope, files };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** 返回所有已注册的工具名称列表（项目+全局） */
export function getRegisteredToolNames(): string[] {
  const names = new Set<string>();
  for (const t of PROJECT_TOOLS) names.add(t.name);
  for (const t of HOME_TOOLS) names.add(t.name);
  return Array.from(names).sort();
}

/** 扫描项目目录 */
export async function scanProject(cwd: string, toolFilter?: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (const tool of PROJECT_TOOLS) {
    if (toolFilter && tool.name.toLowerCase() !== toolFilter.toLowerCase()) continue;
    const r = await scanToolInDir(tool, cwd, 'project');
    if (r) results.push(r);
  }

  return results;
}

/** 扫描用户主目录 */
export async function scanHome(toolFilter?: string): Promise<ScanResult[]> {
  const homeDir = os.homedir();
  const results: ScanResult[] = [];

  for (const tool of HOME_TOOLS) {
    if (toolFilter && tool.name.toLowerCase() !== toolFilter.toLowerCase()) continue;
    const r = await scanToolInDir(tool, homeDir, 'home');
    if (r) results.push(r);
  }

  return results;
}

/** 扫描项目目录 + 用户主目录 */
export async function scanAll(cwd: string, toolFilter?: string): Promise<ScanResult[]> {
  const [project, home] = await Promise.all([
    scanProject(cwd, toolFilter),
    scanHome(toolFilter),
  ]);
  return [...project, ...home];
}

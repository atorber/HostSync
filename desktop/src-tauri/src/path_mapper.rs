use percent_encoding::{utf8_percent_encode, percent_decode_str, AsciiSet, CONTROLS};

const ENCODE_SET: AsciiSet = CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'[')
    .add(b']')
    .add(b'^')
    .add(b'|')
    .add(b'\\')
    .add(b'+')
    .add(b'@')
    .add(b'&')
    .add(b'=')
    .add(b':')
    .add(b';')
    .add(b',')
    .add(b'$');

pub fn normalize_hostname_for_key(hostname: &str) -> String {
    let lowered = hostname.trim().to_lowercase();
    let replaced: String = lowered
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = replaced
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    collapsed
}

fn encode_key_segment(seg: &str) -> String {
    utf8_percent_encode(seg, &ENCODE_SET).to_string()
}

fn encode_key_path(p: &str) -> String {
    p.split('/')
        .map(|seg| encode_key_segment(seg))
        .collect::<Vec<_>>()
        .join("/")
}

fn abs_path_to_posix_no_leading_slash(abs: &str) -> String {
    let posix = abs.replace('\\', "/");
    let trimmed = posix.trim_start_matches('/');
    trimmed.to_string()
}

pub fn get_remote_prefix() -> String {
    let hostname_raw = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string());
    let host = normalize_hostname_for_key(&hostname_raw);
    host
}

pub fn build_s3_key_for_file(abs_path: &str) -> String {
    let prefix = get_remote_prefix();
    let normalized = abs_path_to_posix_no_leading_slash(abs_path);
    let encoded = encode_key_path(&normalized);
    format!("configs/{}/{}", prefix, encoded)
}

#[allow(dead_code)]
pub fn decode_relative_path(encoded: &str) -> String {
    encoded
        .split('/')
        .map(|seg| {
            percent_decode_str(seg)
                .decode_utf8()
                .unwrap_or_else(|_| seg.into())
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub fn validate_remote_key(key: &str) -> bool {
    if key.is_empty() || key.contains('\\') || key.starts_with('/') || key.contains('\0') {
        return false;
    }
    if key.split('/').any(|p| p == "..") {
        return false;
    }
    key.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '%' | '-' | '/'))
}

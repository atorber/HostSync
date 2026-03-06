use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Builder as S3ConfigBuilder, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

use crate::config::HostSyncConfig;

fn parse_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

pub fn create_client(cfg: &HostSyncConfig) -> Result<Client, Box<dyn std::error::Error + Send + Sync>> {
    let endpoint = parse_endpoint(&cfg.endpoint);
    let region = cfg
        .region
        .as_deref()
        .unwrap_or("us-east-1")
        .to_string();
    let force_path_style = cfg.force_path_style.unwrap_or(true);

    let credentials =
        Credentials::from_keys(&cfg.access_key, &cfg.secret_key, None);

    let s3_config = S3ConfigBuilder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new(region))
        .endpoint_url(&endpoint)
        .force_path_style(force_path_style)
        .credentials_provider(credentials)
        .build();

    Ok(Client::from_conf(s3_config))
}

pub struct S3ObjectInfo {
    pub key: String,
    pub size: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

fn is_no_such_key(err: &(dyn std::error::Error + Send + Sync)) -> bool {
    let msg = err.to_string();
    msg.contains("NoSuchKey") || msg.contains("404")
}

pub async fn list_all_objects(
    client: &Client,
    bucket: &str,
    prefix: &str,
) -> Result<Vec<S3ObjectInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let mut results = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix);

        if let Some(ref token) = continuation_token {
            req = req.continuation_token(token);
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if is_no_such_key(&e) {
                    return Ok(results);
                }
                return Err(e.into());
            }
        };

        for obj in resp.contents() {
            if let Some(key) = obj.key() {
                results.push(S3ObjectInfo {
                    key: key.to_string(),
                    size: obj.size().map(|s| s as u64),
                    etag: obj.e_tag().map(String::from),
                    last_modified: obj
                        .last_modified()
                        .map(|t| t.to_string()),
                });
            }
        }

        if resp.is_truncated().unwrap_or(false) {
            continuation_token = resp.next_continuation_token().map(String::from);
            if continuation_token.is_none() {
                break;
            }
        } else {
            break;
        }
    }

    Ok(results)
}

pub async fn get_object_bytes(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await?;

    let body = resp.body;
    let bytes = body.collect().await?.into_bytes();
    Ok(bytes.to_vec())
}

pub async fn put_object_bytes(
    client: &Client,
    bucket: &str,
    key: &str,
    body: &[u8],
    content_type: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(body.to_vec()))
        .content_type(content_type)
        .send()
        .await?;
    Ok(())
}

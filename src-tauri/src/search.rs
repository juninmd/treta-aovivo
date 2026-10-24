//! DuckDuckGo's HTML endpoint answers 403 to requests carrying an Origin
//! header, and the HTTP plugin always adds one. This command fetches only
//! DuckDuckGo result pages, without Origin and without following redirects.

use serde::Serialize;
use std::time::Duration;

const HOST: &str = "html.duckduckgo.com";
const PATH: &str = "/html/";
const MAX_BODY: usize = 2 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

#[derive(Serialize)]
pub struct Page {
    status: u16,
    body: String,
}

fn check_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| e.to_string())?;
    let ok = url.scheme() == "https" && url.host_str() == Some(HOST) && url.port().is_none() && url.path() == PATH && url.username().is_empty() && url.password().is_none();
    ok.then_some(url).ok_or_else(|| format!("only https://{HOST}{PATH} search pages are allowed"))
}

#[tauri::command]
pub async fn search_page(url: String) -> Result<Page, String> {
    let url = check_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(url).header("Accept-Language", "pt-BR,pt;q=0.9").send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BODY {
        return Err("search page too large".into());
    }
    Ok(Page { status, body: String::from_utf8_lossy(&bytes).into_owned() })
}

#[cfg(test)]
mod tests {
    use super::check_url;

    #[test]
    fn only_duckduckgo_result_pages_pass() {
        assert!(check_url("https://html.duckduckgo.com/html/?q=selic&kl=br-pt").is_ok());
        for bad in [
            "http://html.duckduckgo.com/html/?q=x",
            "https://html.duckduckgo.com.evil.test/html/?q=x",
            "https://evil.test/?u=https://html.duckduckgo.com/html/",
            "https://user@html.duckduckgo.com/html/?q=x",
            "https://html.duckduckgo.com:8443/html/?q=x",
            "https://html.duckduckgo.com/other",
            "file:///C:/Windows/win.ini",
            "",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }
}

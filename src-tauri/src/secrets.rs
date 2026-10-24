//! API keys live in the OS credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service), never in app config files.

const SERVICE: &str = "dev.juninmd.treta-aovivo";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    let ok = !key.is_empty() && key.len() <= 64 && key.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if !ok {
        return Err("invalid secret name".into());
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    let e = entry(&key)?;
    if value.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(&value).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_outside_the_allowlist() {
        assert!(entry("").is_err());
        assert!(entry("../etc").is_err());
        assert!(entry(&"a".repeat(65)).is_err());
        assert!(entry("llm.apiKey").is_ok());
    }
}

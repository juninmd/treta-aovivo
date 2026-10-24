fn main() {
    // With an app manifest, the webview may call only the commands its capability grants.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "start_engine",
        "stop_engine",
        "merge_speakers",
        "check_tools",
        "search_page",
        "save_debate",
        "secret_set",
        "secret_get",
    ])))
    .expect("failed to run tauri-build");
}

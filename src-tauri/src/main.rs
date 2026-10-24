// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some(treta_aovivo_lib::ENGINE_FLAG) {
        std::process::exit(treta_aovivo_lib::serve_engine());
    }
    treta_aovivo_lib::run()
}

fn main() {
    #[cfg(all(feature = "desktop", target_os = "windows"))]
    tauri_build::build();
}

fn main() {
    #[cfg(all(feature = "desktop", any(target_os = "windows", target_os = "linux")))]
    tauri_build::build();
}

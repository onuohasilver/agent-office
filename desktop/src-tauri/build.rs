fn main() {
    // The bundled office is staged into app/ by scripts/stage.mjs for release
    // builds; a debug build runs the repo directly, so an empty one will do.
    let _ = std::fs::create_dir_all("app");
    tauri_build::build()
}

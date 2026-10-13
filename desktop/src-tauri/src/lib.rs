// The desktop shell around the office. It starts the same Node server the
// `agentoffice` CLI starts, through the user's login shell so `node` and
// `claude` are on PATH even when launched from Finder, then points a window at
// it. Closing the app sends the server SIGTERM so it saves on the way out.
//
// If an office is already running on the same data folder (started from a
// terminal, say), the window attaches to it instead: two servers on one data
// folder fight over the same jobs.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const BOOT_TIMEOUT: Duration = Duration::from_secs(60);
const STOP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct Office {
    // The supervisor we started, if we started one.
    child: Mutex<Option<Child>>,
    // The loading page, to go back to when the office restarts.
    loading: Mutex<Option<Url>>,
    // Where the office is, once it is up.
    link: Mutex<Option<Url>>,
}

// The office code: the repo itself in a debug build, the bundled copy otherwise.
fn app_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
    } else {
        app.path().resource_dir().expect("no resource dir").join("app")
    }
}

// Same default as the CLI, so the app and `agentoffice` share one office.
fn data_dir() -> PathBuf {
    match std::env::var_os("OFFICE_DATA") {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => home().join(".agent-office"),
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn root_file(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().expect("no config dir").join("projects-root")
}

// The folder whose subfolders are the projects: OFFICE_ROOT, else the one
// chosen before, else ask. `force` asks again.
fn projects_root(app: &AppHandle, force: bool) -> Option<PathBuf> {
    if !force {
        if let Some(r) = std::env::var_os("OFFICE_ROOT").filter(|r| !r.is_empty()) {
            return Some(PathBuf::from(r));
        }
        if let Ok(saved) = fs::read_to_string(root_file(app)) {
            let p = PathBuf::from(saved.trim());
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    let picked = app
        .dialog()
        .file()
        .set_title("Choose the folder that holds your projects")
        .set_directory(home())
        .blocking_pick_folder()?
        .into_path()
        .ok()?;
    let file = root_file(app);
    let _ = fs::create_dir_all(file.parent().unwrap());
    let _ = fs::write(&file, picked.to_string_lossy().as_bytes());
    Some(picked)
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn office_link(port: u16, data: &Path) -> Option<Url> {
    let key = fs::read_to_string(data.join("office-key")).ok()?;
    Url::parse(&format!("http://127.0.0.1:{port}/?key={}", key.trim())).ok()
}

// An office already serving this data folder, if there is one.
fn running_office(data: &Path) -> Option<Url> {
    let port: u16 = fs::read_to_string(data.join("office-port")).ok()?.trim().parse().ok()?;
    if listening(port) { office_link(port, data) } else { None }
}

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn status(win: &WebviewWindow, text: &str) {
    let _ = win.eval(format!("window.officeStatus && officeStatus({})", js_str(text)));
}

fn fail(win: &WebviewWindow, title: &str, detail: &str) {
    let _ = win.eval(format!("window.officeError && officeError({}, {})", js_str(title), js_str(detail)));
}

fn log_tail(path: &Path, lines: usize) -> String {
    let Ok(f) = fs::File::open(path) else { return String::new() };
    let all: Vec<String> = BufReader::new(f).lines().map_while(Result::ok).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

// The PATH the user's shell sets up. Apps opened from Finder get a bare
// PATH, which has neither `node` nor `claude`. -i as well as -l, because
// version managers (nvm, fnm, asdf) usually set PATH in the interactive rc.
fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell)
        .args(["-ilc", r#"printf '\n__PATH__%s__PATH__\n' "$PATH""#])
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.rfind("__PATH__")?;
    let before = &text[..start];
    let open = before.rfind("__PATH__")? + "__PATH__".len();
    Some(before[open..].to_string()).filter(|p| !p.is_empty())
}

fn find_node(path: &str) -> Option<PathBuf> {
    std::env::split_paths(path).map(|d| d.join("node")).find(|n| n.is_file())
}

fn spawn_office(app: &AppHandle, root: &Path, port: u16, data: &Path, log: &Path) -> Result<Child, String> {
    let path = login_path().unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    let node = find_node(&path).ok_or_else(|| {
        format!("Node.js 20 or newer must be installed and on your shell's PATH.\n\nPATH was: {path}")
    })?;
    let script = app_dir(app).join("bin").join("agentoffice.js");
    let out = OpenOptions::new().create(true).append(true).open(log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    Command::new(node)
        .arg(&script)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(root)
        .env("PATH", path)
        .env("OFFICE_ROOT", root)
        .env("OFFICE_DATA", data)
        .env("OFFICE_DESKTOP", "1")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| e.to_string())
}

// Find or start the office and show it. Runs off the main thread: the folder
// dialog and the wait for the server both block.
fn open_office(app: AppHandle, force_pick: bool) {
    thread::spawn(move || {
        let Some(win) = app.get_webview_window("main") else { return };
        let data = data_dir();
        let state = app.state::<Office>();

        if !force_pick {
            if let Some(link) = running_office(&data) {
                *state.link.lock().unwrap() = Some(link.clone());
                let _ = win.navigate(link);
                return;
            }
        }

        status(&win, "Choosing your projects folder.");
        let Some(root) = projects_root(&app, force_pick) else {
            fail(&win, "No projects folder", "The office needs a folder whose subfolders are your projects.\nChoose one from Office › Choose Projects Folder…");
            return;
        };

        let _ = fs::create_dir_all(&data);
        let log = data.join("desktop.log");
        let port = match free_port() {
            Ok(p) => p,
            Err(e) => return fail(&win, "No free port", &e.to_string()),
        };
        status(&win, &format!("Starting the server in {}.", root.display()));
        match spawn_office(&app, &root, port, &data, &log) {
            Ok(child) => *state.child.lock().unwrap() = Some(child),
            Err(e) => return fail(&win, "Couldn't start the office", &e),
        }

        let started = Instant::now();
        loop {
            if listening(port) {
                break;
            }
            let exited = state.child.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten());
            if let Some(code) = exited {
                state.child.lock().unwrap().take();
                return fail(&win, "The office stopped while starting", &format!("Exit {code}.\n{}\n\nFull log: {}", log_tail(&log, 30), log.display()));
            }
            if started.elapsed() > BOOT_TIMEOUT {
                return fail(&win, "The office is taking too long to start", &format!("{}\n\nFull log: {}", log_tail(&log, 30), log.display()));
            }
            thread::sleep(Duration::from_millis(250));
        }

        match office_link(port, &data) {
            Some(link) => {
                *state.link.lock().unwrap() = Some(link.clone());
                let _ = win.navigate(link);
            }
            None => fail(&win, "No office key", &format!("The server started but {} is missing.", data.join("office-key").display())),
        }
    });
}

// SIGTERM lets the server save its state; it gets a few seconds before SIGKILL.
fn stop_office(app: &AppHandle) {
    let state = app.state::<Office>();
    *state.link.lock().unwrap() = None;
    let Some(mut child) = state.child.lock().unwrap().take() else { return };
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    let started = Instant::now();
    while started.elapsed() < STOP_TIMEOUT {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn is_local(url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "about" | "data" | "blob")
        || matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost"))
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let office = Submenu::with_items(
        app,
        "Office",
        true,
        &[
            &MenuItem::with_id(app, "choose-root", "Choose Projects Folder…", true, None::<&str>)?,
            &MenuItem::with_id(app, "open-browser", "Open in Browser", true, None::<&str>)?,
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
        ],
    )?;
    menu.append(&office)?;
    Ok(menu)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Office::default())
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "choose-root" => {
                let app = app.clone();
                thread::spawn(move || {
                    stop_office(&app);
                    if let (Some(w), Some(url)) = (app.get_webview_window("main"), app.state::<Office>().loading.lock().unwrap().clone()) {
                        let _ = w.navigate(url);
                    }
                    // Give the loading page a moment before it gets status calls.
                    thread::sleep(Duration::from_millis(500));
                    open_office(app, true);
                });
            }
            "open-browser" => {
                if let Some(link) = app.state::<Office>().link.lock().unwrap().clone() {
                    let _ = tauri_plugin_opener::open_url(link.as_str(), None::<&str>);
                }
            }
            "reload" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("location.reload()");
                }
            }
            _ => {}
        })
        .setup(|app| {
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Agent Office")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .on_navigation(|url| {
                    if is_local(url) {
                        return true;
                    }
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;
            *app.state::<Office>().loading.lock().unwrap() = win.url().ok();
            // A plain kill (or Ctrl-C under `tauri dev`) should still close the
            // office properly rather than orphan the server.
            #[cfg(unix)]
            {
                use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
                let handle = app.handle().clone();
                let mut signals = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP])?;
                thread::spawn(move || {
                    if signals.forever().next().is_some() {
                        handle.exit(0);
                    }
                });
            }
            open_office(app.handle().clone(), false);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Agent Office app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_office(app);
        }
    });
}

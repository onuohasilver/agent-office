// The desktop shell around the office. It starts the same Node server the
// `agentoffice` CLI starts, through the user's login shell so `node` and
// `claude` are on PATH even when launched from Finder, then points a window at
// it. Closing the app sends the server SIGTERM so it saves on the way out.
//
// If an office is already running on the same data folder (started from a
// terminal, say), the window attaches to it instead: two servers on one data
// folder fight over the same jobs.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::ipc::CapabilityBuilder;
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
    // Ports whose office page has been given IPC.
    granted: Mutex<HashSet<u16>>,
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

fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let inner = Sha256::new().chain_update(k.map(|b| b ^ 0x36)).chain_update(msg).finalize();
    Sha256::new().chain_update(k.map(|b| b ^ 0x5c)).chain_update(inner).finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// Whether the server on `port` holds this office's key, asked without sending
// it: the office answers HMAC(key, "agent-office-proof:<port>:<nonce>"). A
// stale office-port can name a port some other program has since taken, and
// that program must never see the key.
fn proves_key(port: u16, key: &str) -> bool {
    let mut nonce = [0u8; 32];
    if getrandom::fill(&mut nonce).is_err() {
        return false;
    }
    let nonce = hex(&nonce);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut conn) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return false };
    let _ = conn.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = conn.set_write_timeout(Some(Duration::from_secs(3)));
    let req = format!("GET /api/desktop/proof?nonce={nonce} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if conn.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut res = Vec::new();
    let _ = conn.take(64 * 1024).read_to_end(&mut res);
    let res = String::from_utf8_lossy(&res);
    if !(res.starts_with("HTTP/1.") && res.split(' ').nth(1) == Some("200")) {
        return false;
    }
    let Some((_, body)) = res.split_once("\r\n\r\n") else { return false };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) else { return false };
    let Some(got) = v.get("proof").and_then(|p| p.as_str()) else { return false };
    let want = hex(&hmac_sha256(key.as_bytes(), format!("agent-office-proof:{port}:{nonce}").as_bytes()));
    got.len() == want.len() && got.bytes().zip(want.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
}

// The link into the office on `port`, key included, once it has proved it is
// the office for this data folder.
fn office_link(port: u16, data: &Path) -> Option<Url> {
    let key = fs::read_to_string(data.join("office-key")).ok()?;
    let key = key.trim();
    if !proves_key(port, key) {
        return None;
    }
    Url::parse(&format!("http://127.0.0.1:{port}/?key={key}")).ok()
}

// An office already serving this data folder, if there is one.
fn running_office(data: &Path) -> Option<Url> {
    let port: u16 = fs::read_to_string(data.join("office-port")).ok()?.trim().parse().ok()?;
    if listening(port) { office_link(port, data) } else { None }
}

// The office page gets the shell's IPC (the opener, mainly), but only from
// its own origin: the static capability is local-only, so this is added once
// the port is known and proved.
fn grant_ipc(app: &AppHandle, port: u16) {
    let state = app.state::<Office>();
    if !state.granted.lock().unwrap().insert(port) {
        return;
    }
    let cap = CapabilityBuilder::new(format!("office-{port}"))
        .remote(format!("http://127.0.0.1:{port}/*"))
        .window("main")
        .permission("core:default")
        .permission("opener:default");
    if let Err(e) = app.add_capability(cap) {
        eprintln!("[desktop] couldn't grant the office page IPC: {e}");
        state.granted.lock().unwrap().remove(&port);
    }
}

// Show the office in the window.
fn attach(app: &AppHandle, win: &WebviewWindow, link: Url) {
    if let Some(port) = link.port() {
        grant_ipc(app, port);
    }
    *app.state::<Office>().link.lock().unwrap() = Some(link.clone());
    let _ = win.navigate(link);
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
    // Only this account may read the log: it's the server's whole output.
    let mut opts = OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        opts.mode(0o600);
        // mode() only applies to a new file; an older log may be 0644.
        if log.exists() {
            let _ = fs::set_permissions(log, fs::Permissions::from_mode(0o600));
        }
    }
    let out = opts.open(log).map_err(|e| e.to_string())?;
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
                return attach(&app, &win, link);
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

        // Listening isn't enough: something else may have taken the port
        // between free_port() and the server binding it.
        let started = Instant::now();
        let link = loop {
            if listening(port) {
                if let Some(link) = office_link(port, &data) {
                    break link;
                }
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
        };
        attach(&app, &win, link);
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

// What may load in the window: the loading page, blank frames, and the
// office we attached to. Any other page on localhost is someone else's, and
// must not get the window's IPC.
fn in_window(url: &Url, office: Option<&Url>) -> bool {
    let same = |u: &Url| office.is_some_and(|o| u.origin() == o.origin());
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "blob" => Url::parse(url.path()).is_ok_and(|inner| same(&inner)),
        "http" if url.host_str() == Some("tauri.localhost") => true,
        _ => same(url),
    }
}

// Only these go to the system's opener. The opener's scope doesn't apply to
// calls from Rust, so file:, smb: and app schemes would otherwise reach the OS.
fn openable(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
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
            let handle = app.handle().clone();
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Agent Office")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                // Called for every frame, iframes included.
                .on_navigation(move |url| {
                    let office = handle.state::<Office>().link.lock().unwrap().clone();
                    if in_window(url, office.as_ref()) {
                        return true;
                    }
                    if openable(url) {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
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

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 4231, test case 2.
    #[test]
    fn hmac_matches_rfc4231() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(hex(&mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn window_keeps_only_the_office() {
        let office = Url::parse("http://127.0.0.1:4317/?key=k").unwrap();
        let ok = |s: &str| in_window(&Url::parse(s).unwrap(), Some(&office));
        assert!(ok("http://127.0.0.1:4317/settings"));
        assert!(ok("tauri://localhost/index.html"));
        assert!(ok("about:blank"));
        assert!(ok("blob:http://127.0.0.1:4317/0b6c"));
        assert!(!ok("http://127.0.0.1:5173/"));
        assert!(!ok("http://localhost:4317/"));
        assert!(!ok("blob:http://127.0.0.1:5173/0b6c"));
        assert!(!ok("data:text/html,hi"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!in_window(&Url::parse("http://127.0.0.1:4317/").unwrap(), None));
        assert!(openable(&Url::parse("https://example.com").unwrap()));
        assert!(openable(&Url::parse("mailto:a@b.c").unwrap()));
        for s in ["file:///Applications/Calculator.app", "smb://host/share", "vscode://x", "javascript:alert(1)"] {
            assert!(!openable(&Url::parse(s).unwrap()), "{s}");
        }
    }

    // A stand-in server that answers the proof route the way server/index.js
    // does, for `port_in_mac`. Run with node on PATH.
    fn fake_office(key: &str, port_in_mac: Option<u16>) -> (u16, std::process::Child) {
        let port = free_port().unwrap();
        let mac_port = port_in_mac.unwrap_or(port);
        let js = format!(
            "const c=require('crypto');require('http').createServer((q,s)=>{{const n=new URL(q.url,'http://x').searchParams.get('nonce');s.writeHead(200,{{'content-type':'application/json'}});s.end(JSON.stringify({{proof:c.createHmac('sha256','{key}').update(`agent-office-proof:{mac_port}:${{n}}`).digest('hex')}}))}}).listen({port},'127.0.0.1')"
        );
        let child = Command::new("node").args(["-e", &js]).spawn().expect("node");
        let t = Instant::now();
        while !listening(port) && t.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(50));
        }
        (port, child)
    }

    #[test]
    #[ignore = "needs node"]
    fn proof_handshake() {
        let key = "ab".repeat(32);
        let (port, mut good) = fake_office(&key, None);
        assert!(proves_key(port, &key));
        assert!(!proves_key(port, &"cd".repeat(32)));
        // A relay: the real office signs its own port, not the stale one.
        let (relay, mut bad) = fake_office(&key, Some(port));
        assert!(!proves_key(relay, &key));
        let _ = good.kill();
        let _ = bad.kill();
        // Nothing listening.
        assert!(!proves_key(port, &key));
    }
}

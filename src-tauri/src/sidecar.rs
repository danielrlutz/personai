use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    /// True when we attached to an already-running API (do not kill on exit).
    pub adopted: Mutex<bool>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(4000),
            adopted: Mutex::new(false),
        }
    }
}

const DEFAULT_PORT: u16 = 4000;

/// Prefer the default API port so the web client can talk without a round-trip;
/// fall back to an ephemeral port when 4000 is busy.
pub fn find_free_port() -> u16 {
    match TcpListener::bind(("127.0.0.1", DEFAULT_PORT)) {
        Ok(listener) => {
            // Keep the bind only long enough to confirm availability, then release.
            let port = listener.local_addr().map(|a| a.port()).unwrap_or(DEFAULT_PORT);
            drop(listener);
            port
        }
        Err(_) => TcpListener::bind("127.0.0.1:0")
            .ok()
            .and_then(|l| l.local_addr().ok())
            .map(|a| a.port())
            .unwrap_or(DEFAULT_PORT),
    }
}

fn server_entry(resource_dir: &PathBuf) -> Option<PathBuf> {
    let candidates = [
        resource_dir.join("apps/server/dist/index.js"),
        resource_dir.join("../apps/server/dist/index.js"),
        resource_dir.join("../../apps/server/dist/index.js"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../apps/server/dist/index.js"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn health_ok(port: u16) -> bool {
    let addr = match format!("127.0.0.1:{port}").to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };

    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(80)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(150)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(150)));

    let req = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 12 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn wait_for_sidecar(port: u16, child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    let poll = Duration::from_millis(40);

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("Sidecar exited early: {status}"));
        }
        if health_ok(port) {
            return Ok(());
        }
        std::thread::sleep(poll);
    }

    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!("Sidecar exited early: {status}"));
    }
    Err(format!(
        "Sidecar did not become healthy on http://127.0.0.1:{port}/health within 12s"
    ))
}

fn set_port(state: &SidecarState, port: u16) {
    if let Ok(mut p) = state.port.lock() {
        *p = port;
    }
}

fn mark_adopted(state: &SidecarState, adopted: bool) {
    if let Ok(mut a) = state.adopted.lock() {
        *a = adopted;
    }
}

/// Hide the Node console on Windows (CREATE_NO_WINDOW). Users must not see or
/// babysit a sidecar terminal — closing it would kill the API.
fn apply_no_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// Attach to an already-running PersonAI API if it answers /health.
pub fn adopt_existing_api(state: &SidecarState, port: u16) -> bool {
    if !health_ok(port) {
        return false;
    }
    set_port(state, port);
    mark_adopted(state, true);
    if let Ok(mut child) = state.child.lock() {
        *child = None;
    }
    true
}

/// Spawn the Node API sidecar, or adopt an existing healthy process on :4000.
/// Never panics — failures are returned as Err so the desktop shell can keep running.
pub fn spawn_sidecar(state: &SidecarState, data_dir: PathBuf) -> Result<u16, String> {
    // Graceful path: external `pnpm dev:server` (or a leftover sidecar) already up.
    if adopt_existing_api(state, DEFAULT_PORT) {
        println!("[personai] Reusing existing API on http://127.0.0.1:{DEFAULT_PORT}");
        return Ok(DEFAULT_PORT);
    }

    let port = find_free_port();
    // Another process may have bound 4000 between the health check and bind probe;
    // if that process is our API, adopt it instead of fighting for the port.
    if port != DEFAULT_PORT && adopt_existing_api(state, DEFAULT_PORT) {
        println!("[personai] Reusing existing API on http://127.0.0.1:{DEFAULT_PORT}");
        return Ok(DEFAULT_PORT);
    }

    let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let entry = server_entry(&resource_dir).ok_or_else(|| {
        "Server entry dist/index.js not found. Run `pnpm build:server` once before tauri:dev."
            .to_string()
    })?;

    let mut cmd = Command::new("node");
    cmd.arg(&entry)
        .env("PORT", port.to_string())
        .env("DATA_DIR", &data_dir)
        .env("OLLAMA_HOST", "http://127.0.0.1:11434")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Never allocate a visible console for the API process (prod + tauri:dev:fast).
    apply_no_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    if let Err(err) = wait_for_sidecar(port, &mut child) {
        let _ = child.kill();
        let _ = child.wait();
        // Last chance: something else (or a racing relaunch) may now own a healthy API.
        if adopt_existing_api(state, DEFAULT_PORT) {
            eprintln!("[personai] Spawn failed ({err}); adopted healthy API on :{DEFAULT_PORT}");
            return Ok(DEFAULT_PORT);
        }
        return Err(err);
    }

    set_port(state, port);
    mark_adopted(state, false);
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    Ok(port)
}

pub fn kill_sidecar(state: &SidecarState) {
    let adopted = state.adopted.lock().map(|g| *g).unwrap_or(false);
    if adopted {
        // Do not kill an API we did not start (e.g. `pnpm dev:server`).
        return;
    }
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

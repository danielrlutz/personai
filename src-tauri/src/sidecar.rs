use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(4000),
        }
    }
}

/// Prefer the default API port so the web client can talk without a round-trip;
/// fall back to an ephemeral port when 4000 is busy.
pub fn find_free_port() -> u16 {
    if TcpListener::bind("127.0.0.1:4000").is_ok() {
        return 4000;
    }
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(4000)
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

pub fn spawn_sidecar(state: &SidecarState, data_dir: PathBuf) -> Result<u16, String> {
    let port = find_free_port();
    let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let entry = server_entry(&resource_dir).ok_or_else(|| {
        "Server entry dist/index.js not found. Run `pnpm build:server` once before tauri:dev."
            .to_string()
    })?;

    let mut child = Command::new("node")
        .arg(&entry)
        .env("PORT", port.to_string())
        .env("DATA_DIR", data_dir)
        .env("OLLAMA_HOST", "http://127.0.0.1:11434")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    if let Err(err) = wait_for_sidecar(port, &mut child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }

    *state.port.lock().map_err(|e| e.to_string())? = port;
    *state.child.lock().map_err(|e| e.to_string())? = Some(child);
    Ok(port)
}

pub fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

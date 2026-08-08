use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

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

pub fn find_free_port() -> u16 {
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

pub fn spawn_sidecar(state: &SidecarState, data_dir: PathBuf) -> Result<u16, String> {
    let port = find_free_port();
    let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let entry = server_entry(&resource_dir)
        .ok_or_else(|| "Server entry dist/index.js not found. Run pnpm build:server first.".to_string())?;

    let mut child = Command::new("node")
        .arg(&entry)
        .env("PORT", port.to_string())
        .env("DATA_DIR", data_dir)
        .env("OLLAMA_HOST", "http://127.0.0.1:11434")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // brief wait for boot
    std::thread::sleep(std::time::Duration::from_millis(800));
    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!("Sidecar exited early: {status}"));
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

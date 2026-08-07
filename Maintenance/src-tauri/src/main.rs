#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const SERVICE_PORT: u16 = 6968;

struct ServiceState(Mutex<Option<Child>>);

struct ServicePaths {
    script: PathBuf,
    data_root: PathBuf,
}

fn service_address() -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), SERVICE_PORT)
}

fn service_is_ready() -> bool {
    let address = service_address();
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let request = b"GET /api/library HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = [0_u8; 256];
    let bytes = stream.read(&mut response).unwrap_or(0);
    let header = String::from_utf8_lossy(&response[..bytes]);
    header.starts_with("HTTP/1.1 200") || header.starts_with("HTTP/1.0 200")
}

fn find_node() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("MEDIA_MANAGER_NODE") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
    }
    for candidate in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    let path = PathBuf::from("node");
    if Command::new(&path).arg("--version").output().is_ok() {
        return Ok(path);
    }
    Err("Node.js was not found. Set MEDIA_MANAGER_NODE to the Node executable path.".into())
}

fn development_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("could not create {}: {error}", destination.display()))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not inspect bundled source: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("could not inspect {}: {error}", source_path.display()))?;
        if file_type.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "could not copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn service_paths(app: &AppHandle) -> Result<ServicePaths, String> {
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("could not resolve the Tauri resource directory: {error}"))?
        .join("app-resources");
    if resource_root.join("Maintenance/service.mjs").is_file() {
        let data_root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("could not resolve the app data directory: {error}"))?;
        let source_root = data_root.join("Sources");
        if !source_root.join("Files/Anime").is_dir() {
            copy_directory(&resource_root.join("Sources"), &source_root)?;
        }
        return Ok(ServicePaths {
            script: resource_root.join("Maintenance/service.mjs"),
            data_root,
        });
    }
    let root = development_root();
    Ok(ServicePaths {
        script: root.join("Maintenance/service.mjs"),
        data_root: root,
    })
}

fn start_service(paths: &ServicePaths) -> Result<Option<Child>, String> {
    if service_is_ready() {
        return Ok(None);
    }
    let node = find_node()?;
    if !paths.script.is_file() {
        return Err(format!(
            "maintenance service is missing at {}",
            paths.script.display()
        ));
    }
    let child = Command::new(node)
        .arg(&paths.script)
        .current_dir(&paths.data_root)
        .env("CREATOR_TORRENT_PORT", SERVICE_PORT.to_string())
        .env("CREATOR_TORRENT_HOST", "127.0.0.1")
        .env("MEDIA_MANAGER_ROOT", &paths.data_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start the maintenance service: {error}"))?;
    Ok(Some(child))
}

fn wait_for_service(child: &mut Option<Child>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if service_is_ready() {
            return Ok(());
        }
        if let Some(process) = child.as_mut() {
            if let Some(status) = process
                .try_wait()
                .map_err(|error| format!("could not inspect the maintenance service: {error}"))?
            {
                return Err(format!("maintenance service exited during startup: {status}"));
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("maintenance service did not become ready on port {SERVICE_PORT}"))
}

fn stop_service(state: &ServiceState) {
    let Ok(mut guard) = state.0.lock() else { return };
    let Some(mut child) = guard.take() else { return };
    let _ = child.kill();
    let _ = child.wait();
}

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let url = format!("index.html?service=http://127.0.0.1:{SERVICE_PORT}");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("Media Manager Maintenance")
        .inner_size(1400.0, 900.0)
        .min_inner_size(900.0, 650.0)
        .center()
        .build()?;
    Ok(())
}

fn run() -> Result<(), String> {
    tauri::Builder::default()
        .setup(|app| {
            let paths = service_paths(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let mut child = start_service(&paths)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            wait_for_service(&mut child)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(ServiceState(Mutex::new(child)));
            create_window(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|error| error.to_string())?
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app_handle.try_state::<ServiceState>() {
                    stop_service(&state);
                }
            }
        });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Media Manager Maintenance failed: {error}");
        std::process::exit(1);
    }
}

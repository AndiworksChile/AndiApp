use std::process::Command;
use std::{fs, path::PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAttachment {
  id: String,
  file_name: String,
  mime_type: String,
  size_bytes: usize,
  storage_path: String,
}

fn sanitize_file_name(raw: &str, fallback: &str) -> String {
  let mut safe: String = raw
    .trim()
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' || ch == ' ' {
        ch
      } else {
        '_'
      }
    })
    .collect();

  safe = safe.trim_matches('.').trim().to_string();
  if safe.is_empty() {
    fallback.to_string()
  } else {
    safe
  }
}

fn attachment_root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("No se pudo resolver la carpeta de datos de la app: {e}"))?;
  let root = base.join("attachments");
  fs::create_dir_all(&root).map_err(|e| format!("No se pudo preparar la carpeta de adjuntos: {e}"))?;
  Ok(root)
}

fn resolve_attachment_path(app: &tauri::AppHandle, storage_path: &str) -> Result<PathBuf, String> {
  let raw = storage_path.trim().replace('\\', "/");
  if raw.is_empty() {
    return Err("Ruta de adjunto vacia.".to_string());
  }

  if raw.starts_with('/') || raw.contains("..") {
    return Err("Ruta de adjunto invalida.".to_string());
  }

  if !raw.starts_with("attachments/") {
    return Err("Ruta de adjunto fuera del directorio permitido.".to_string());
  }

  let root = attachment_root_dir(app)?;
  let relative = raw.trim_start_matches("attachments/");
  Ok(root.join(relative))
}

#[tauri::command]
fn store_attachment_file(
  app: tauri::AppHandle,
  data_base64: String,
  file_name: String,
  mime_type: String,
) -> Result<StoredAttachment, String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(data_base64.trim())
    .map_err(|e| format!("No se pudo decodificar el adjunto: {e}"))?;

  if bytes.is_empty() {
    return Err("El archivo adjunto esta vacio.".to_string());
  }

  let safe_name = sanitize_file_name(&file_name, "documento.bin");
  let ext = PathBuf::from(&safe_name)
    .extension()
    .and_then(|s| s.to_str())
    .map(|s| s.to_ascii_lowercase())
    .unwrap_or_else(|| "bin".to_string());

  let root = attachment_root_dir(&app)?;
  let millis = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "No se pudo generar identificador de adjunto.".to_string())?
    .as_millis();

  let mut selected_file_name = String::new();
  let mut selected_path = PathBuf::new();

  for attempt in 0..5000 {
    let candidate = format!("att-{millis}-{attempt}.{ext}");
    let candidate_path = root.join(&candidate);
    if !candidate_path.exists() {
      selected_file_name = candidate;
      selected_path = candidate_path;
      break;
    }
  }

  if selected_file_name.is_empty() {
    return Err("No se pudo crear un nombre unico para el adjunto.".to_string());
  }

  fs::write(&selected_path, &bytes).map_err(|e| format!("No se pudo guardar el adjunto: {e}"))?;

  Ok(StoredAttachment {
    id: selected_file_name.trim_end_matches(&format!(".{ext}")).to_string(),
    file_name: safe_name,
    mime_type: if mime_type.trim().is_empty() {
      "application/octet-stream".to_string()
    } else {
      mime_type.trim().to_string()
    },
    size_bytes: bytes.len(),
    storage_path: format!("attachments/{selected_file_name}"),
  })
}

#[tauri::command]
fn read_attachment_as_data_url(
  app: tauri::AppHandle,
  storage_path: String,
  mime_type: String,
) -> Result<String, String> {
  let path = resolve_attachment_path(&app, &storage_path)?;
  let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?;
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  let mime = if mime_type.trim().is_empty() {
    "application/octet-stream"
  } else {
    mime_type.trim()
  };
  Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn delete_attachment_file(app: tauri::AppHandle, storage_path: String) -> Result<(), String> {
  let path = resolve_attachment_path(&app, &storage_path)?;
  if path.exists() {
    fs::remove_file(path).map_err(|e| format!("No se pudo eliminar el adjunto: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let trimmed = url.trim();
  if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
    return Err("Solo se permiten enlaces http/https.".to_string());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(trimmed)
      .spawn()
      .map_err(|e| format!("No se pudo abrir el enlace: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/C", "start", "", trimmed])
      .spawn()
      .map_err(|e| format!("No se pudo abrir el enlace: {e}"))?;
    return Ok(());
  }

  #[cfg(target_os = "linux")]
  {
    Command::new("xdg-open")
      .arg(trimmed)
      .spawn()
      .map_err(|e| format!("No se pudo abrir el enlace: {e}"))?;
    return Ok(());
  }

  #[allow(unreachable_code)]
  Err("Sistema operativo no soportado para abrir enlaces externos.".to_string())
}

#[tauri::command]
fn save_pdf_to_downloads(data_url: String, file_name: String) -> Result<String, String> {
  let trimmed = data_url.trim();
  if !trimmed.starts_with("data:application/pdf;base64,") {
    return Err("El archivo recibido no corresponde a un PDF válido.".to_string());
  }

  let encoded = trimmed
    .split_once(',')
    .map(|(_, value)| value)
    .ok_or_else(|| "No se pudo leer el contenido del PDF.".to_string())?;

  let bytes = base64::engine::general_purpose::STANDARD
    .decode(encoded)
    .map_err(|e| format!("No se pudo decodificar el PDF: {e}"))?;

  let downloads_dir = dirs::download_dir()
    .or_else(dirs::home_dir)
    .ok_or_else(|| "No se pudo determinar la carpeta de Descargas.".to_string())?;

  let requested = file_name.trim();
  let mut safe_name: String = requested
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' || ch == ' ' {
        ch
      } else {
        '_'
      }
    })
    .collect();

  if safe_name.is_empty() {
    safe_name = "documento.pdf".to_string();
  }
  if !safe_name.to_ascii_lowercase().ends_with(".pdf") {
    safe_name.push_str(".pdf");
  }

  let mut candidate: PathBuf = downloads_dir.join(&safe_name);
  if candidate.exists() {
    let stem = candidate
      .file_stem()
      .and_then(|s| s.to_str())
      .unwrap_or("documento")
      .to_string();
    let ext = candidate
      .extension()
      .and_then(|s| s.to_str())
      .unwrap_or("pdf")
      .to_string();

    let mut index = 1;
    loop {
      let next_name = format!("{stem} ({index}).{ext}");
      let next_path = downloads_dir.join(next_name);
      if !next_path.exists() {
        candidate = next_path;
        break;
      }
      index += 1;
      if index > 9999 {
        return Err("No se pudo encontrar un nombre disponible para guardar el PDF.".to_string());
      }
    }
  }

  fs::write(&candidate, bytes).map_err(|e| format!("No se pudo guardar el PDF: {e}"))?;
  Ok(candidate.to_string_lossy().to_string())
}

#[tauri::command]
fn save_file_with_dialog(data_base64: String, file_name: String) -> Result<String, String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(data_base64.trim())
    .map_err(|e| format!("No se pudo decodificar el archivo: {e}"))?;

  let requested = file_name.trim();
  let mut safe_name: String = requested
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' || ch == ' ' {
        ch
      } else {
        '_'
      }
    })
    .collect();

  if safe_name.is_empty() {
    safe_name = "respaldo.json".to_string();
  }

  let target = rfd::FileDialog::new()
    .set_file_name(&safe_name)
    .save_file()
    .ok_or_else(|| "USER_CANCELLED".to_string())?;

  fs::write(&target, bytes).map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
  Ok(target.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      open_external_url,
      save_pdf_to_downloads,
      save_file_with_dialog,
      store_attachment_file,
      read_attachment_as_data_url,
      delete_attachment_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

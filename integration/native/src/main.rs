use eframe::egui;
use serde::Deserialize;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{io::Write, path::PathBuf, process::Command, sync::mpsc, time::Duration};

#[derive(Deserialize)]
struct Recording {
    title: String,
    department: String,
    purpose: String,
    url: String,
    #[serde(default)]
    needs_review: bool,
}
#[derive(Default, Deserialize)]
struct Config {
    root_folder_id: String,
}
struct Library {
    query: String,
    results: Vec<Recording>,
    message: String,
    busy: bool,
    api_key: String,
    settings: bool,
    key_message: String,
    worker: PathBuf,
    config: Config,
    tx: mpsc::Sender<Result<Vec<Recording>, String>>,
    rx: mpsc::Receiver<Result<Vec<Recording>, String>>,
}
impl Library {
    fn new() -> Self {
        let resources = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("Resources");
        let config = std::fs::read(resources.join("library.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let (tx, rx) = mpsc::channel();
        Self {
            query: String::new(),
            results: vec![],
            message: "Search recording titles and complete transcripts.".into(),
            busy: false,
            api_key: String::new(),
            settings: false,
            key_message: String::new(),
            worker: resources.join("screenity-library"),
            config,
            tx,
            rx,
        }
    }
    fn save_key(&mut self) {
        let key = self.api_key.trim();
        if key.len() < 20 || key.contains(['\r', '\n', '\0', '\'', '"']) {
            self.key_message = "Paste the API key by itself, without quotes.".into();
            return;
        }
        let save = (|| -> std::io::Result<()> {
            let directory =
                PathBuf::from(std::env::var_os("HOME").unwrap()).join(".config/screenity-library");
            std::fs::create_dir_all(&directory)?;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            let file = directory.join("jev.env");
            let mut output = std::fs::OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .mode(0o600)
                .open(&file)?;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))?;
            writeln!(output, "TYPESAFE_API_KEY='{key}'")?;
            output.sync_all()?;
            Ok(())
        })();
        if save.is_ok() {
            self.api_key.clear();
            self.key_message =
                "Saved privately on this Mac. The key is not stored in iCloud.".into();
        } else {
            self.key_message = "Could not save the key on this Mac.".into();
        }
    }
    fn search(&mut self) {
        if self.busy || self.query.trim().is_empty() {
            return;
        }
        self.busy = true;
        let query = self
            .query
            .split_whitespace()
            .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ");
        let worker = self.worker.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = Command::new(worker)
                .args(["search", &query])
                .output()
                .map_err(|_| "Could not start the recording library.".into())
                .and_then(|out| {
                    if !out.status.success() {
                        return Err("The library could not complete this search.".into());
                    }
                    serde_json::from_slice(&out.stdout)
                        .map_err(|_| "Could not read the search results.".into())
                });
            let _ = tx.send(result);
        });
    }
}
impl eframe::App for Library {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        if let Ok(result) = self.rx.try_recv() {
            self.busy = false;
            match result {
                Ok(recordings) => {
                    self.message = format!("{} matching recordings", recordings.len());
                    self.results = recordings;
                }
                Err(error) => self.message = error,
            }
        }
        egui::CentralPanel::default().show(ui, |ui| {
            ui.horizontal(|ui|{ui.heading("Screenity Library");if ui.button("JEV settings").clicked(){self.settings=!self.settings;}}); ui.add_space(12.0);
            if self.settings {
                ui.group(|ui| {
                    ui.strong("Connect your existing JEV account");
                    ui.label("Paste your TypeSafe / JEV API key below. It stays in a private local file on this Mac.");
                    ui.horizontal(|ui|{
                        ui.add(egui::TextEdit::singleline(&mut self.api_key).password(true).hint_text("JEV API key").desired_width(470.0));
                        if ui.button("Save key").clicked(){self.save_key();}
                    });
                    ui.label(&self.key_message);
                });
                ui.add_space(12.0);
            }
            ui.horizontal(|ui| {
                let edit = ui.add(egui::TextEdit::singleline(&mut self.query).hint_text("Find a topic, tool, person, or process").desired_width(470.0));
                let enter = edit.lost_focus() && ui.input(|i|i.key_pressed(egui::Key::Enter));
                if ui.add_enabled(!self.busy,egui::Button::new("Search")).clicked() || enter { self.search(); }
            });
            ui.label(&self.message);
            if self.busy { ui.spinner(); ui.ctx().request_repaint_after(Duration::from_millis(100)); }
            ui.add_space(8.0);
            if !self.config.root_folder_id.is_empty() { ui.hyperlink_to("Open recording folders",format!("https://drive.google.com/drive/folders/{}",self.config.root_folder_id)); }
            ui.separator();
            egui::ScrollArea::vertical().show(ui, |ui| {
                for r in &self.results {
                    ui.group(|ui| {
                        ui.strong(&r.title); ui.label(format!("{} / {}",r.department,r.purpose));
                        if r.needs_review { ui.label("Suggested category — needs review"); }
                        if r.url.starts_with("https://drive.google.com/file/d/") { ui.hyperlink_to("Watch recording",&r.url); }
                    }); ui.add_space(5.0);
                }
            });
        });
    }
}
fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([720.0, 500.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Screenity Library",
        options,
        Box::new(|_| Ok(Box::new(Library::new()))),
    )
}

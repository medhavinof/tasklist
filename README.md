# Simple Task List

Aplikasi web manajemen tugas lokal (**Simple Task List**) berbasis **Node.js**, **Express**, **SQLite (`node:sqlite`)**, dan arsitektur frontend **Native ES Modules** tanpa build step. Seluruh data profil, kategori, tugas, sub-tugas, dan preferensi tersimpan secara lokal pada database SQLite dengan dukungan isolasi multi-akun.

---

## Ringkasan Fitur Utama

1. **Autentikasi & Identitas Profil Lokal**
   - Registrasi dan login lokal per perangkat menggunakan **Password** atau **PIN 4–6 digit**.
   - Kustomisasi **foto profil / avatar** (unggah gambar atau pilih preset emoji), **nama tampilan**, dan **username** unik.
   - **Multi-Account Switcher** untuk berpindah antar profil lokal pada satu perangkat.
2. **Keamanan Lokal (Tanpa Email)**
   - Ubah password / PIN lokal dengan verifikasi kredensial lama.
   - **Pertanyaan Keamanan (Security Question)** untuk pemulihan akses ketika lupa password/PIN lokal.
   - **Auto-Lock** untuk mengunci sesi otomatis setelah tidak aktif sesuai durasi pilihan, lengkap dengan layar kunci (`LockScreen`).
3. **Manajemen Tugas, Deskripsi & Sub-Tugas**
   - Tambah cepat, edit inline, tandai selesai, dan hapus tugas.
   - **Tenggat waktu (`due_at`)** dan **prioritas** (`low`, `medium`, `high`) lengkap dengan indikator status jatuh tempo.
   - **Deskripsi tugas** dengan panel detail collapsible dan formatting aman (`renderFormattedDescription`).
   - **Sub-tugas & progress bar** persentase per tugas, serta opsi preferensi untuk menyelesaikan tugas utama otomatis saat seluruh sub-tugas selesai 100%.
4. **Manajemen Kategori & Multi-Kategori**
   - Kelola daftar kategori per profil (tambah, edit nama/warna/ikon, hapus tanpa menghapus tugas).
   - 8 palet warna dan 9 ikon SVG untuk membedakan kategori secara visual.
   - **Multi-Select Category Picker** pada form tambah maupun edit tugas, tampilan badge ringkas (`+N`), serta filter multi-kategori mode **`DAN` (semua cocok)** atau **`ATAU` (salah satu cocok)**.
5. **Dashboard Ringkasan & Filter Lanjutan**
   - Kartu KPI ringkasan (Progres Penyelesaian, Jatuh Tempo Hari Ini, Terlambat, Prioritas Tinggi) yang dapat diklik untuk memfilter daftar tugas, serta ringkasan per kategori berwarna.
   - Pencarian teks, filter status, prioritas, rentang jatuh tempo, kategori, dan pengurutan.
6. **Tema, Preferensi & Backup Data Lokal**
   - Dukungan **Dark Mode / Light Mode** dan 5 pilihan warna aksen (aksesibilitas WCAG AA).
   - **Export / Import Backup (`.json`)** dalam mode gabung (`merge`) atau timpa (`replace`) mencakup profil, kategori, tugas, dan sub-tugas.
   - **Reset Data Tugas** (menghapus tugas tanpa menghapus akun) dan **Hapus Profil Lokal** secara permanen.

---

## Teknologi yang Digunakan

- **Runtime & Backend**: Node.js (`node:sqlite` bawaan), Express `^5.3.0`
- **Database**: SQLite lokal (default: `data/todo.db`)
- **Frontend**: HTML5, Modular CSS (`public/styles/*.css`), Vanilla JavaScript **Native ES Modules** (`public/js/`)
- **Pengujian**: `node --test` (`tests/api.test.js`)

---

## Menjalankan Aplikasi

Pastikan **Node.js** versi terbaru yang mendukung modul `node:sqlite` sudah terpasang (diuji pada Node v24+).

1. **Instal dependensi**
   ```bash
   npm install
   ```

2. **Jalankan server produksi**
   ```bash
   npm start
   ```
   Aplikasi berjalan di `http://localhost:3000`.

3. **Jalankan mode pengembangan (auto-reload)**
   ```bash
   npm run dev
   ```

4. **Jalankan pengujian otomatis**
   ```bash
   npm test
   ```

5. **Buat production build standalone (`.exe` tanpa perlu Node.js di PC target)**
   ```bash
   npm run build
   ```
   Hasil build utama akan tersedia di `dist/SimpleTaskList.exe` (atau `npm run build:bundle` untuk hanya menghasilkan bundle `dist/build/`).

### Instalasi & Penggunaan Build Produksi (`SimpleTaskList.exe`)
1. Jalankan `npm run build` di mesin pengembangan untuk menghasilkan `dist/SimpleTaskList.exe`.
2. Salin **1 file `SimpleTaskList.exe`** ke folder mana saja di komputer Windows target (tidak perlu menginstal Node.js, npm, SQLite, atau tools tambahan lainnya).
3. Klik ganda `SimpleTaskList.exe`:
   - Server akan berjalan dan otomatis membuka browser ke URL aplikasi (default `http://localhost:3000`, atau otomatis pindah ke port kosong berikutnya jika sedang dipakai).
   - Database lokal tersimpan secara portable di subfolder `./data/todo.db` tepat di sebelah file `SimpleTaskList.exe`.
   - Untuk mode headless / server tanpa membuka browser otomatis, jalankan dengan argumen `--no-open` atau variabel lingkungan `NO_OPEN=1`.

### Variabel Lingkungan (Opsional)
- `PORT`: Port server HTTP (default: `3000`).
- `DB_PATH`: Lokasi file database SQLite (default: `data/todo.db`).

---

## Struktur Proyek

```text
todo-app/
├── server.js                     # Entry point server HTTP & graceful shutdown
├── package.json                  # Konfigurasi proyek dan skrip npm
├── src/
│   ├── app.js                    # Konfigurasi Express, middleware & routing API
│   ├── db.js                     # Inisialisasi skema SQLite & migrasi otomatis
│   ├── auth.js                   # Autentikasi, session, unlock & recovery lokal
│   ├── categories.js             # CRUD kategori per profil & default seeding
│   ├── tasks.js                  # CRUD tugas, sub-tugas, filter, sorting & summary
│   └── profile.js                # Profil, keamanan, preferensi, export/import JSON & reset
├── public/
│   ├── index.html                # Kerangka HTML aplikasi
│   ├── styles.css                # Entry CSS yang mengimpor modul public/styles/
│   ├── styles/
│   │   ├── tokens.css            # Variabel tema Dark/Light, aksen & warna kategori
│   │   ├── base.css              # Reset, tipografi, tombol, badge, banner & avatar
│   │   ├── auth.css              # Autentikasi, switcher akun, recovery & lock screen
│   │   ├── header-dashboard.css  # Header, dropdown profil & kartu KPI dashboard
│   │   ├── tasks.css             # Form tugas, filter toolbar, kartu tugas & sub-tugas
│   │   └── modals.css            # Modal Pengaturan Lokal & Kelola Kategori
│   └── js/
│       ├── main.js               # Orchestrator aplikasi, event global & auto-lock
│       ├── core/                 # Utilitas inti (api, state, icons, utils, ui-shared)
│       └── components/           # Komponen UI modular (AuthView, LockScreen, HeaderMenu,
│                                 # DashboardPanel, TaskForm, FilterToolbar, TaskDetailPanel,
│                                 # TaskItem, TaskList, SettingsModal, CategoriesModal)
└── tests/
    └── api.test.js               # Suite pengujian integrasi API, SQLite & aset modular
```

---

## Ringkasan Endpoint API

| Prefix | Cakupan Endpoint |
| :--- | :--- |
| `/api/auth` | `GET /accounts`, `POST /register`, `POST /login`, `POST /logout`, `GET /me`, `POST /unlock`, `POST /recover/question`, `POST /recover/reset`, `PATCH /preferences` |
| `/api/tasks` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:taskId/subtasks`, `PATCH /:taskId/subtasks/:subtaskId`, `DELETE /:taskId/subtasks/:subtaskId` |
| `/api/categories` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` |
| `/api/profile` | `PATCH /`, `PATCH /password`, `PATCH /security-question`, `PATCH /preferences`, `GET /export`, `POST /import`, `POST /reset-tasks`, `DELETE /` |

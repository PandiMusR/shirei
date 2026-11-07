# PRD: Shirei

## Ringkasan
*Shirei* (指令, Jepang: komando atau instruksi).

PWA pribadi di VPS buat ngasih prompt ke Cursor Agent, mantau progresnya live, dan lanjutin sesi dari HP (Galaxy A34). Backend-nya ngejalanin Cursor CLI headless (`agent -p --output-format stream-json`) di sandbox terpisah, terus hasilnya di-stream ke HP. Notifikasi push muncul pas task selesai atau gagal. Cuma lu yang pakai.

## Masalah & Tujuan
- **Masalah:** sekarang ngoding pakai agent cuma bisa di depan PC. Pas shift NOC atau lagi di luar, ide atau fix kecil harus nunggu.
- **Tujuan:** dari HP bisa (1) pilih project, (2) kirim prompt, (3) lihat progres dan tool call secara live, (4) stop atau lanjutin sesi, (5) dapat push pas selesai.
- **Bukan tujuan (buat MVP):** multi-user, editor kode lengkap, atau gantiin Cursor desktop.

## Target User
Lu sendiri, dengan satu akun. HP-nya Galaxy A34 (Chrome/Samsung Internet, di-install sebagai PWA).

## Fitur Inti (MVP)
1. Login pribadi (satu user, password + sesi cookie).
2. Project picker. Ada dua sumber:
   - folder yang udah ada di VPS (dari allowlist), atau
   - clone repo GitHub ke workspace sandbox lewat deploy key atau token read/write per repo.
3. Form prompt dengan pilihan mode (agent / plan / ask) dan model.
4. Stream progres live: teks assistant, tool call (mulai dan selesai), hasil akhir.
5. Tombol Stop (kill proses).
6. Riwayat sesi, plus lanjutin sesi lewat `--resume <chatId>`.
7. Web Push (VAPID) pas task selesai, gagal, atau butuh perhatian.

## Nanti (Later)
- Branch git per task, dan auto-commit ke branch `agent/<task>`.
- Diff viewer, lalu tombol commit/push dari HP.
- Antrian multi-task / multi-agent.
- Notifikasi Telegram sebagai cadangan.
- Template prompt favorit.

## User Flow utama
1. Buka PWA dan login.
2. Pilih project (folder VPS atau repo GitHub).
3. Tulis prompt, pilih mode, terus Start.
4. Layar progres muncul dengan event live. HP boleh ditutup.
5. Push masuk: "Task X selesai". Tap notifikasinya buat buka ringkasan hasil.
6. Kalau perlu, kirim follow-up (resume sesi yang sama) atau Stop.

## Data & Integrasi
- **Cursor CLI:** `agent -p --workspace <dir> --output-format stream-json --stream-partial-output [--resume id] [--mode plan|ask] [--model m] [--force] "<prompt>"`, dengan auth lewat `CURSOR_API_KEY` (env, bukan di DB).
  - Event NDJSON: `system` init (session_id), assistant, tool_call started/completed, result.
  - Docs: [CLI headless](https://cursor.com/docs/cli/headless), [format output](https://cursor.com/docs/cli/reference/output-format).
- **GitHub:** clone pakai fine-grained token atau deploy key per repo, cuma repo yang dipilih.
- **DB SQLite:**
  - `projects` (id, nama, path, sumber, repo_url)
  - `tasks` (id, project_id, prompt, mode, model, chat_id, status, started_at, ended_at)
  - `events` (task_id, seq, type, payload JSON)
  - `push_subscriptions`
- **Transport ke HP:** SSE dari backend, dan nyambung ulang pakai `Last-Event-ID`. Karena event-nya disimpan di DB, layar bisa ngejar ketinggalan setelah HP tidur.

## Non-functional
- **Struktur:** semua file di `/srv/shirei/` (`app`, `runner`, `workspaces`).
- **Keamanan (paling penting):**
  - CLI jalan sebagai Linux user `agent` (bukan root), di dalam container Docker. Yang di-mount cuma `/srv/agent-workspaces`.
  - Nggak ada akses ke LibreNMS, Ghost, atau socket Docker host.
  - `--force` cuma boleh di dalam sandbox ini.
  - HTTPS lewat reverse proxy (Caddy/Nginx yang udah ada) di subdomain, misal `shirei.hakanam.my.id`.
  - Login rate-limited. Opsional, IP allowlist atau Tailscale.
  - Secret (`CURSOR_API_KEY`, token GitHub) disimpan di file env dengan permission 600, nggak pernah dikirim ke frontend.
- **Resource:** batasi CPU/RAM container dan maksimal 1–2 task paralel, biar LibreNMS di VPS Contabo nggak keganggu.
- **Reliability:** proses agent tetap jalan walau HP putus. Pas backend restart, task yang masih "running" ditandai sebagai interrupted.
- **Mobile:** layout satu kolom, tombol besar, dark mode, bisa di-install (manifest dan service worker).

## Tech Stack rekomendasi
**Utama: Node + Hono + SQLite (Drizzle) + React/Vite PWA.** Ini sama dengan stack Diurna, jadi pola auth, PWA, dan deploy-nya bisa dipakai ulang.
- `child_process.spawn`, ditambah parser NDJSON per baris, buat jalanin CLI.
- `streamSSE` dari Hono buat stream ke HP.
- Library `web-push` buat VAPID push. Service worker-nya bisa pakai yang di Diurna.
- Docker Compose dengan dua service: `app`, dan `agent-runner` sebagai sandbox.

**Alternatif lebih ringan: FastAPI + HTMX/vanilla JS.** Satu file Python dengan `asyncio.create_subprocess_exec` dan `sse-starlette`, plus `pywebpush`. Lebih simpel, tapi lu nggak dapat reuse dari Diurna.

## Inspirasi
- [Alg0rix/tomo](https://github.com/Alg0rix/tomo), agent swarm buatan temen lu (FastAPI, Apache 2.0). Yang bisa diambil: kartu progres task di chat, task yang otomatis lanjut setelah restart, sandbox lewat container + path jail, panel Workspace/Terminal per chat. Bedanya, Tomo pakai model OpenAI-compatible, bukan Cursor.

## Risiko & Pertanyaan Terbuka
- `--force` artinya agent bisa jalanin command apa aja di dalam sandbox. Isolasinya harus benar-benar ketat.
- Format event stream-json bisa berubah antar versi CLI. Simpan payload mentahnya, dan parse secara toleran.
- Kuota atau biaya Cursor kalau task jalan lama. Tambahin timeout per task.
- RAM VPS dibagi dengan LibreNMS. Perlu dicek berapa yang masih kosong.
- Push di Android butuh PWA yang di-install dan izin notifikasi. Kadang ketahan sama mode hemat baterai Samsung.
- Terbuka: subdomain dan proxy mana yang dipakai? Apakah Tailscale lebih aman daripada buka ke publik?

## Langkah MVP (buat malam/weekend)
1. **Spike (1 malam):** install Cursor CLI sebagai user `agent` di container, jalanin satu prompt `stream-json` manual, simpan contoh output NDJSON-nya.
2. **Backend runner (1–2 malam):** endpoint start/stop task, parser NDJSON yang nyimpen ke tabel `events`, plus SSE dengan replay.
3. **Projects (1 malam):** allowlist folder VPS, plus clone repo GitHub ke workspace.
4. **Frontend (2 malam):** login, project picker, form prompt, layar progres live, riwayat.
5. **Resume dan Stop (1 malam):** follow-up pakai `--resume chat_id`, dan kill proses.
6. **Push (1 malam):** VAPID, subscribe dari PWA, kirim push pas status task final.
7. **Hardening dan deploy (1 malam):** limit container, HTTPS, rate limit, backup SQLite, tes dari A34.

Total sekitar 2 minggu kerja santai.

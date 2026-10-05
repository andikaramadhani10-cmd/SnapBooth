/* camera.js - SnapBooth */
(() => {
    "use strict";

    const DEFAULT_COUNT = 4;

    // ---------- Helper ----------
    const $ = (id) => {
        const el = document.getElementById(id);
        if (!el) console.warn(`[SnapBooth] Elemen #${id} tidak ditemukan di HTML.`);
        return el;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // ---------- Elemen ----------
    const el = {
        portrait: $("portraitButton"),
        landscape: $("landscapeButton"),
        select: $("cameraSelect"),
        container: $("cameraContainer"),
        video: $("camera"),
        overlay: $("cameraOverlay"),
        countdown: $("countdown"),
        start: $("startCamera"),
        mirror: $("mirrorButton"),
        session: $("sessionButton"),
        status: $("sessionStatus"),
        result: $("resultSection"),
        grid: $("photoGrid"),
        editor: $("editorSection"),
        text: $("customText"),
        applyText: $("applyTextButton"),
        canvas: $("templateCanvas"),
        download: $("downloadButton"),
    };

    // ---------- State ----------
    const state = {
        stream: null,
        mirrored: false,
        orientation: "portrait",
        busy: false,
        count: DEFAULT_COUNT,   // jumlah foto per sesi (2 / 4 / 6)
        countdown: 3,           // detik hitung mundur (3 / 5 / 10)
        photos: new Array(DEFAULT_COUNT).fill(null), // canvas mentah tanpa filter
        filter: "normal",
        template: "classic",
        background: "white",
        frame: "none",
        sticker: "none",
        text: "",
    };

    const FILTERS = {
        normal: "none",
        grayscale: "grayscale(1)",
        vintage: "sepia(.5) contrast(1.1) saturate(.8)",
        warm: "sepia(.25) saturate(1.3) hue-rotate(-10deg)",
        cool: "saturate(1.1) hue-rotate(15deg) brightness(1.03)",
        bright: "brightness(1.2) contrast(1.05)",
    };
    const BACKGROUNDS = { white: "#ffffff", black: "#111111", pink: "#ffd1e3", soft: "#e9e9ec" };
    const STICKERS = { star: "★", heart: "♥", spark: "✦", flower: "✿", moon: "☾", music: "♪" };
    const STICKER_COLORS = { star: "#f5b700", heart: "#ff5fa2", spark: "#f5b700", flower: "#ff8fb8", moon: "#7a6cff", music: "#1d1b2e" };

    const setStatus = (msg) => { if (el.status) el.status.textContent = msg; };
    const hasAllPhotos = () => state.photos.every(Boolean);

    // ---------- Kamera ----------
    function stopStream() {
        if (state.stream) {
            state.stream.getTracks().forEach((t) => t.stop());
            state.stream = null;
        }
    }

    async function startStream(deviceId) {
        stopStream();
        const video = { width: { ideal: 1280 }, height: { ideal: 960 } };
        if (deviceId) video.deviceId = { exact: deviceId };

        try {
            state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (err) {
            // sebagian webcam USB menolak pengaturan resolusi, coba tanpa itu
            if (!deviceId) throw err;
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: deviceId } },
                audio: false,
            });
        }
        el.video.srcObject = state.stream;

        // tunggu sampai ukuran video benar-benar tersedia
        await new Promise((resolve) => {
            if (el.video.readyState >= 1 && el.video.videoWidth) return resolve();
            el.video.onloadedmetadata = () => resolve();
        });
        await el.video.play().catch(() => {});
    }

    async function fillDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const current = state.stream?.getVideoTracks()[0]?.getSettings().deviceId;

        el.select.innerHTML = "";
        cams.forEach((cam, i) => {
            const opt = document.createElement("option");
            opt.value = cam.deviceId;
            opt.textContent = cam.label || `Camera ${i + 1}`;
            if (cam.deviceId === current) opt.selected = true;
            el.select.appendChild(opt);
        });
        return cams.length;
    }

    async function activateCamera(deviceId) {
        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus("Browser tidak mendukung kamera. Buka lewat https:// atau localhost.");
            return;
        }
        try {
            setStatus("Mengaktifkan kamera...");
            await startStream(deviceId);
            const total = await fillDevices(); // setelah izin diberikan, label kamera terbaca
            el.overlay.classList.add("is-hidden");
            el.session.disabled = false;
            el.start.textContent = "RESTART CAMERA";
            setStatus(`Kamera aktif (${total} kamera terdeteksi). Pilih kamera di dropdown bila perlu.`);
        } catch (err) {
            console.error(err);
            el.session.disabled = true;
            const msg = {
                NotAllowedError: "Izin kamera ditolak. Izinkan kamera di pengaturan browser.",
                NotFoundError: "Kamera tidak ditemukan.",
                NotReadableError: "Kamera sedang dipakai aplikasi lain.",
                OverconstrainedError: "Kamera yang dipilih tidak tersedia.",
            }[err.name] || `Gagal mengaktifkan kamera (${err.name || "error"}).`;
            setStatus(msg);
        }
    }

    // ---------- Orientasi & mirror ----------
    function setOrientation(value) {
        if (state.busy || value === state.orientation) return;
        state.orientation = value;
        el.container.classList.remove("portrait", "landscape");
        el.container.classList.add(value);
        el.portrait.classList.toggle("active", value === "portrait");
        el.landscape.classList.toggle("active", value === "landscape");

        // ukuran foto lama tidak cocok lagi, jadi reset
        if (state.photos.some(Boolean)) {
            state.photos.fill(null);
            renderPhotoGrid();
            setStatus("Orientasi diganti. Ambil foto ulang.");
        }
    }

    function toggleMirror() {
        state.mirrored = !state.mirrored;
        el.container.classList.toggle("mirrored", state.mirrored);
        el.mirror.textContent = state.mirrored ? "MIRROR: ON" : "MIRROR CAMERA";
    }

    // ---------- Ambil foto ----------
    function capture() {
        const vw = el.video.videoWidth;
        const vh = el.video.videoHeight;
        if (!vw || !vh) throw new Error("Video belum siap");

        const ratio = state.orientation === "portrait" ? 3 / 4 : 4 / 3;
        let sw = vw, sh = vw / ratio;
        if (sh > vh) { sh = vh; sw = vh * ratio; }
        const sx = (vw - sw) / 2, sy = (vh - sh) / 2;

        const c = document.createElement("canvas");
        c.width = state.orientation === "portrait" ? 720 : 960;
        c.height = state.orientation === "portrait" ? 960 : 720;
        const ctx = c.getContext("2d");

        if (state.mirrored) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(el.video, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return c;
    }

    async function runCountdown(seconds = state.countdown) {
        for (let i = seconds; i > 0; i--) {
            el.countdown.textContent = i;
            await wait(1000);
        }
        el.countdown.textContent = "";
        el.container.classList.add("flash");
        await wait(120);
        el.container.classList.remove("flash");
    }

    function setBusy(value) {
        state.busy = value;
        el.session.disabled = value || !state.stream;
        el.start.disabled = value;
        el.select.disabled = value;
        document.querySelectorAll(".setting-buttons button").forEach((b) => (b.disabled = value));
        el.grid?.querySelectorAll("button").forEach((b) => (b.disabled = value));
    }

    async function takeOne(index) {
        await runCountdown();
        state.photos[index] = capture();
    }

    async function startSession() {
        if (state.busy || !state.stream) return;
        setBusy(true);
        state.photos.fill(null);
        renderPhotoGrid();
        try {
            for (let i = 0; i < state.count; i++) {
                setStatus(`Foto ${i + 1} dari ${state.count} · hitung mundur ${state.countdown} detik. Bersiap...`);
                await takeOne(i);
                renderPhotoGrid();
                await wait(500);
            }
            setStatus("Selesai! Atur tampilan di bawah atau ulangi foto tertentu.");
        } catch (err) {
            console.error(err);
            setStatus("Gagal mengambil foto. Coba aktifkan kamera lagi.");
        } finally {
            setBusy(false);
            renderPhotoGrid();
            renderEditorIfReady();
        }
    }

    async function retake(index) {
        if (state.busy) return;
        setBusy(true);
        try {
            setStatus(`Mengulang foto ${index + 1}...`);
            await takeOne(index);
            setStatus("Foto diperbarui.");
        } catch (err) {
            console.error(err);
            setStatus("Gagal mengulang foto.");
        } finally {
            setBusy(false);
            renderPhotoGrid();
            renderEditorIfReady();
        }
    }

    // ---------- Daftar hasil foto ----------
    function renderPhotoGrid() {
        el.grid.innerHTML = "";
        const any = state.photos.some(Boolean);
        el.result.classList.toggle("is-hidden", !any);
        if (!any) { renderEditorIfReady(); return; }

        state.photos.forEach((photo, i) => {
            const item = document.createElement("div");
            item.className = "photo-item";
            if (photo) {
                const img = document.createElement("img");
                img.src = photo.toDataURL("image/jpeg", 0.85);
                img.alt = `Foto ${i + 1}`;
                item.appendChild(img);
            }
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "retake-button";
            btn.textContent = `RETAKE ${i + 1}`;
            btn.disabled = state.busy;
            btn.addEventListener("click", () => retake(i));
            item.appendChild(btn);
            el.grid.appendChild(item);
        });
    }

    // ---------- Editor & canvas ----------
    function renderEditorIfReady() {
        const ready = hasAllPhotos();
        el.editor.classList.toggle("is-hidden", !ready);
        if (ready) renderCanvas();
    }

    function layoutFor(template, pw, ph) {
        // pw/ph = ukuran satu foto di hasil akhir
        const n = state.count;
        const cfg = {
            classic:  { cols: 2, rows: Math.ceil(n / 2), pad: 40, gap: 24, footer: 110, mat: 0 },
            polaroid: { cols: 2, rows: Math.ceil(n / 2), pad: 50, gap: 44, footer: 140, mat: 14 },
            strip:    { cols: 1, rows: n, pad: 36, gap: 20, footer: 110, mat: 0 },
        }[template];
        const matBottom = template === "polaroid" ? 46 : 0;
        const cellW = pw + cfg.mat * 2;
        const cellH = ph + cfg.mat * 2 + matBottom;
        const w = cfg.pad * 2 + cfg.cols * cellW + (cfg.cols - 1) * cfg.gap;
        const h = cfg.pad * 2 + cfg.rows * cellH + (cfg.rows - 1) * cfg.gap + cfg.footer;
        return { ...cfg, matBottom, cellW, cellH, w, h };
    }

    function renderCanvas() {
        if (!hasAllPhotos() || !el.canvas) return;

        const portrait = state.orientation === "portrait";
        // strip lebih ramping supaya tidak terlalu panjang
        const base = state.template === "strip" ? 0.7 : 1;
        const pw = Math.round((portrait ? 330 : 440) * base);
        const ph = Math.round((portrait ? 440 : 330) * base);
        const L = layoutFor(state.template, pw, ph);

        el.canvas.width = L.w;
        el.canvas.height = L.h;
        const ctx = el.canvas.getContext("2d");
        const dark = state.background === "black";

        // background
        ctx.fillStyle = BACKGROUNDS[state.background] || "#fff";
        ctx.fillRect(0, 0, L.w, L.h);

        // foto
        state.photos.forEach((photo, i) => {
            const col = i % L.cols;
            const row = Math.floor(i / L.cols);
            const x = L.pad + col * (L.cellW + L.gap);
            const y = L.pad + row * (L.cellH + L.gap);

            if (L.mat) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(x, y, L.cellW, L.cellH);
                ctx.strokeStyle = "rgba(0,0,0,.15)";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, L.cellW, L.cellH);
            }
            ctx.save();
            ctx.filter = FILTERS[state.filter] || "none"; // tidak didukung Safari iOS lama
            ctx.drawImage(photo, x + L.mat, y + L.mat, pw, ph);
            ctx.restore();
        });

        // teks
        if (state.text) {
            ctx.fillStyle = dark ? "#ffffff" : "#111111";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            let size = 40;
            ctx.font = `600 ${size}px sans-serif`;
            while (ctx.measureText(state.text).width > L.w - 100 && size > 16) {
                size -= 2;
                ctx.font = `600 ${size}px sans-serif`;
            }
            ctx.fillText(state.text, L.w / 2, L.h - L.footer / 2 - L.pad / 4);
        }

        // stiker
        if (state.sticker !== "none") {
            const s = STICKERS[state.sticker];
            ctx.fillStyle = STICKER_COLORS[state.sticker] || "#f5b700";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "64px sans-serif";
            [[0.1, 0.06], [0.9, 0.06], [0.1, 0.94], [0.9, 0.94]].forEach(([fx, fy]) =>
                ctx.fillText(s, L.w * fx, L.h * fy));
        }

        // frame
        const frames = {
            thin: ["#111111", 8], bold: ["#111111", 28], pink: ["#ff5fa2", 22],
            gold: ["#d4a017", 22], double: ["#111111", 8], dashed: ["#111111", 10],
        };
        const fr = frames[state.frame];
        if (fr) {
            const [color, w] = fr;
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            if (state.frame === "dashed") ctx.setLineDash([24, 16]);
            ctx.strokeRect(w / 2, w / 2, L.w - w, L.h - w);
            ctx.setLineDash([]);
            if (state.frame === "double") {
                ctx.lineWidth = 3;
                ctx.strokeRect(w + 12, w + 12, L.w - 2 * (w + 12), L.h - 2 * (w + 12));
            }
        }
    }

    function download() {
        if (!hasAllPhotos()) { setStatus("Ambil semua foto dulu sebelum download."); return; }
        renderCanvas();
        const a = document.createElement("a");
        a.download = `snapbooth-${Date.now()}.jpg`;
        a.href = el.canvas.toDataURL("image/jpeg", 0.92);
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // ---------- Tombol pilihan (aktif per grup) ----------
    function bindOptionGroups() {
        document.querySelectorAll(".customize-buttons[data-group]").forEach((group) => {
            const key = group.dataset.group; // filter | template | background | frame | sticker
            group.querySelectorAll("button").forEach((btn) => {
                btn.addEventListener("click", () => {
                    // hanya menghapus 'active' di grup ini
                    group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    state[key] = btn.dataset[key];
                    renderCanvas();
                });
            });
        });
    }

    // ---------- Pengaturan: jumlah foto, countdown, tema ----------
    function applyTheme(name) {
        document.documentElement.dataset.theme = name;
        try { localStorage.setItem("snapbooth-theme", name); } catch (e) {}
    }

    function bindSettings() {
        document.querySelectorAll(".setting-buttons").forEach((group) => {
            const key = group.dataset.setting;
            group.querySelectorAll("button").forEach((btn) => {
                btn.addEventListener("click", () => {
                    if (state.busy) return;
                    group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    const v = btn.dataset.value;
                    if (key === "theme") applyTheme(v);
                    if (key === "countdown") {
                        state.countdown = Number(v);
                        setStatus(`Hitung mundur ${v} detik.`);
                    }
                    if (key === "count") {
                        state.count = Number(v);
                        state.photos = new Array(state.count).fill(null);
                        renderPhotoGrid();
                        setStatus(`${v} foto per sesi.`);
                    }
                });
            });
        });
        try {
            const saved = localStorage.getItem("snapbooth-theme");
            if (saved) {
                document.querySelectorAll('.setting-buttons[data-setting="theme"] button')
                    .forEach((b) => b.classList.toggle("active", b.dataset.value === saved));
            }
        } catch (e) {}
    }

    // ---------- Pasang event ----------
    function init() {
        if (!el.video || !el.start || !el.session) {
            console.error("[SnapBooth] Elemen penting tidak ada. Cek ID di camera.html.");
            return;
        }

        el.start.addEventListener("click", () => activateCamera(el.select?.value || undefined));
        el.select?.addEventListener("change", () => {
            if (el.select.value) activateCamera(el.select.value);
        });
        el.mirror?.addEventListener("click", toggleMirror);
        el.session.addEventListener("click", startSession);
        el.portrait?.addEventListener("click", () => setOrientation("portrait"));
        el.landscape?.addEventListener("click", () => setOrientation("landscape"));

        el.applyText?.addEventListener("click", () => {
            state.text = el.text.value.trim();
            renderCanvas();
        });
        el.text?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { state.text = el.text.value.trim(); renderCanvas(); }
        });
        el.download?.addEventListener("click", download);

        // daftar kamera ter-update otomatis saat webcam dicolok / dicabut
        navigator.mediaDevices?.addEventListener("devicechange", () => {
            if (state.stream) fillDevices();
        });

        bindSettings();
        bindOptionGroups();
        window.addEventListener("pagehide", stopStream);
    }

    init();
})();
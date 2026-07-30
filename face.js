let faceModelsLoaded = false;
async function loadFaceModels() {
  if (faceModelsLoaded) return;
  const statusEl = document.getElementById('register-face-status');
  if (statusEl) statusEl.innerText = "Memuat kecerdasan buatan...";

  try {
    // 1. Coba muat langsung dari folder lokal ./models
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models")
    ]);
    faceModelsLoaded = true;
    if (statusEl) statusEl.innerText = "Posisikan wajah Anda di tengah layar...";
    return;
  } catch (e) {
    console.warn("Gagal memuat model lokal, mencoba CDN backup...", e);
  }

  // 2. Fallback CDN GitHub jika lokal bermasalah
  try {
    const cdnUrl = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(cdnUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(cdnUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(cdnUrl)
    ]);
    faceModelsLoaded = true;
    if (statusEl) statusEl.innerText = "Posisikan wajah Anda di tengah layar...";
  } catch (err) {
    console.error("Gagal total memuat model AI:", err);
    if (statusEl) {
      statusEl.innerText = "Gagal memuat model AI. Periksa koneksi internet.";
      statusEl.className = "badge bg-danger-subtle text-danger-emphasis fs-6 border border-danger-subtle rounded-pill px-3 py-2";
    }
  }
}

let faceDescriptorTemp = null;
let videoStreamTemp = null;

function skipRegisterFace() {
  sessionStorage.setItem("facePromptSkipped", "true");
  if (videoStreamTemp) {
    videoStreamTemp.getTracks().forEach(track => track.stop());
  }
  const modalEl = document.getElementById('modalRegisterFace');
  if (modalEl) {
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
  }
}

async function checkAndRegisterFace() {
  if (!currentUser) return;
  
  // Jika sudah mendaftar wajah, jangan munculkan modal pendaftaran
  if (currentUser.face_descriptor) return;
  
  const statusEl = document.getElementById('register-face-status');
  const modalEl = document.getElementById('modalRegisterFace');
  if (!modalEl) return;

  const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
  modal.show();
  
  if (statusEl) {
    statusEl.innerText = "Menghidupkan kamera...";
    statusEl.className = "badge bg-info-subtle text-info-emphasis fs-6 border border-info-subtle rounded-pill px-3 py-2";
  }

  // Matikan stream kamera lama jika ada
  if (videoStreamTemp) {
    try {
      videoStreamTemp.getTracks().forEach(track => track.stop());
    } catch(e) {}
    videoStreamTemp = null;
  }
  
  const video = document.getElementById('video-register-face');
  try {
    // Coba dengan facingMode front camera, jika gagal fallback ke video standar (Support Laptop/PC & HP)
    try {
      videoStreamTemp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    } catch (e1) {
      videoStreamTemp = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    video.srcObject = videoStreamTemp;
    await video.play().catch(e => console.warn("Video play error:", e));
  } catch (e) {
    console.error("Camera access error:", e);
    if (statusEl) {
      statusEl.innerText = `Kamera gagal diakses: ${e.message || "Izin ditolak"}`;
      statusEl.className = "badge bg-danger-subtle text-danger-emphasis fs-6 border border-danger-subtle rounded-pill px-3 py-2";
    }
    return;
  }
  
  if (statusEl) {
    statusEl.innerText = "Memuat model AI & Posisikan Wajah...";
    statusEl.className = "badge bg-warning-subtle text-warning-emphasis fs-6 border border-warning-subtle rounded-pill px-3 py-2";
  }

  // Load model AI jika belum siap
  await loadFaceModels();
  
  if (statusEl) {
    statusEl.innerText = "Posisikan wajah Anda di tengah layar...";
    statusEl.className = "badge bg-warning-subtle text-warning-emphasis fs-6 border border-warning-subtle rounded-pill px-3 py-2";
  }

  faceDescriptorTemp = null;
  const detectInterval = setInterval(async () => {
    if (faceDescriptorTemp || !videoStreamTemp) {
      clearInterval(detectInterval);
      return;
    }

    try {
      if (video.videoWidth && video.videoHeight) {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

        const detection = await faceapi
          .detectSingleFace(tempCanvas, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          faceDescriptorTemp = detection.descriptor;
          if (statusEl) {
            statusEl.innerText = "Wajah Terdeteksi! Silakan klik 'Simpan Data Wajah'.";
            statusEl.className = "badge bg-success-subtle text-success-emphasis fs-6 border border-success-subtle rounded-pill px-3 py-2";
          }
          const btnSimpan = document.getElementById('btn-simpan-wajah');
          if (btnSimpan) btnSimpan.disabled = false;
          clearInterval(detectInterval);
        }
      }
    } catch (err) {
      console.warn("Detection loop warning:", err);
    }
  }, 500);
}

async function simpanWajahUser() {
  if (!faceDescriptorTemp) return;
  const btn = document.getElementById('btn-simpan-wajah');
  btn.disabled = true;
  btn.innerText = "Menyimpan...";
  
  // Ambil foto wajah saat ini
  const video = document.getElementById('video-register-face');
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg");
  
  const faceDescriptorArray = Array.from(faceDescriptorTemp);
  const descriptorStr = JSON.stringify(faceDescriptorArray);
  
  const { error } = await supabaseClient.from('users').update({
    face_descriptor: descriptorStr,
    foto_wajah: dataUrl
  }).eq('id', currentUser.id);
  
  if (error) {
    Swal.fire("Gagal", error.message, "error");
    btn.disabled = false;
    btn.innerText = "Simpan Data Wajah";
    return;
  }
  
  // Update currentUser session
  currentUser.face_descriptor = descriptorStr;
  currentUser.foto_wajah = dataUrl;
  localStorage.setItem("userLogin", JSON.stringify(currentUser));
  
  // Stop kamera
  if(videoStreamTemp) {
    videoStreamTemp.getTracks().forEach(track => track.stop());
  }
  
  bootstrap.Modal.getInstance(document.getElementById('modalRegisterFace')).hide();
  Swal.fire("Berhasil", "Wajah Anda berhasil didaftarkan!", "success");
}

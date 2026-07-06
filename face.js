let faceModelsLoaded = false;
async function loadFaceModels() {
  if (faceModelsLoaded) return;
  const modelUrl = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
  ]);
  faceModelsLoaded = true;
}

let faceDescriptorTemp = null;
let videoStreamTemp = null;

async function checkAndRegisterFace() {
  if (!currentUser) return;
  
  // Selalu load model di background saat startup
  await loadFaceModels();
  
  if (currentUser.face_descriptor) return; // Sudah terdaftar
  
  const modal = new bootstrap.Modal(document.getElementById('modalRegisterFace'));
  modal.show();
  
  document.getElementById('register-face-status').innerText = "Menghidupkan kamera...";
  document.getElementById('register-face-status').innerText = "Menghidupkan kamera...";
  
  const video = document.getElementById('video-register-face');
  try {
    videoStreamTemp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = videoStreamTemp;
  } catch (e) {
    document.getElementById('register-face-status').innerText = "Kamera tidak dapat diakses!";
    return;
  }
  
  video.addEventListener('play', () => {
    document.getElementById('register-face-status').innerText = "Posisikan wajah Anda di tengah layar...";
    const canvas = document.getElementById('canvas-register-face');
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);
    
    setInterval(async () => {
      if (faceDescriptorTemp) return; // Stop if already captured
      
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      tempCanvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
      const detection = await faceapi.detectSingleFace(tempCanvas, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
        
      if (detection) {
        document.getElementById('register-face-status').innerText = "Wajah terdeteksi! Silakan simpan.";
        document.getElementById('register-face-status').className = "badge bg-success-subtle text-success-emphasis fs-6 border border-success-subtle rounded-pill px-3 py-2";
        document.getElementById('btn-simpan-wajah').disabled = false;
        faceDescriptorTemp = detection.descriptor;
      }
    }, 500);
  });
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

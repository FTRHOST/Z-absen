// admin.js - Logika Khusus Halaman Admin

const currentUserData = localStorage.getItem('userLogin');
const currentUser = currentUserData ? JSON.parse(currentUserData) : {};
let isSuperAdmin = currentUser.role === 'Super Admin';
let myCabang = currentUser.cabang || '';

// Pastikan elemen dimuat
document.addEventListener("DOMContentLoaded", async () => {
    // Pastikan user sudah login (Cek lokal)
    if (!currentUserData) {
        window.location.href = "login.html";
        return;
    }

    // --- Cek Sesi JWT & Profil Resmi ---
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            throw new Error("Sesi tidak valid");
        }
        
        // Cek profil dari backend secara aman
        const { data: profile, error } = await supabaseClient
            .from('users')
            .select('role, cabang')
            .eq('auth_id', session.user.id)
            .single();
            
        if (error || !profile) throw new Error("Profil tidak valid");
        
        // Jika ternyata dia bukan Admin/HR, tendang keluar ke halaman absen
        if (profile.role !== 'Super Admin' && profile.role !== 'HR') {
            window.location.href = "index.html";
            return;
        }

        // Sinkronisasi hak akses
        if (profile.role !== currentUser.role || profile.cabang !== currentUser.cabang) {
            currentUser.role = profile.role;
            currentUser.cabang = profile.cabang;
            isSuperAdmin = profile.role === 'Super Admin';
            myCabang = profile.cabang || '';
            localStorage.setItem('userLogin', JSON.stringify({...currentUser, ...profile}));
            // Refresh halaman agar UI menyesuaikan
            window.location.reload();
            return;
        }
    } catch (e) {
        await supabaseClient.auth.signOut();
        localStorage.removeItem('userLogin');
        window.location.href = "login.html";
        return;
    }

    // Handle Tab Routing
    let hash = window.location.hash || '#tab-dashboard';
    const targetTab = document.querySelector(`[data-bs-target="${hash}"]`);
    if (targetTab) {
        new bootstrap.Tab(targetTab).show();
        if (hash === '#tab-pengaturan') loadSettings();
        if (hash === '#tab-danger') loadTrash();
    } else {
        // Fallback jika hash tidak valid
        new bootstrap.Tab(document.querySelector('[data-bs-target="#tab-dashboard"]')).show();
    }

    // Update hash when a tab is clicked
    const tabEls = document.querySelectorAll('button[data-bs-toggle="pill"]');
    tabEls.forEach(tab => {
        tab.addEventListener('shown.bs.tab', (event) => {
            const target = event.target.getAttribute('data-bs-target');
            if(target) {
                history.replaceState(null, null, target);
            }
        });
    });

    /// Pengaturan Dropdown Role berdasarkan hak akses
    const roleDropdown = document.getElementById("role-karyawan");
    if (roleDropdown) {
        if (isSuperAdmin) {
            // Jika yang login Super Admin, tambahkan opsi "Super Admin" secara dinamis ke dropdown
            if (!document.getElementById("opt-superadmin")) {
                const optSA = document.createElement("option");
                optSA.value = "Super Admin";
                optSA.id = "opt-superadmin";
                optSA.innerText = "Super Admin";
                roleDropdown.appendChild(optSA);
            }
        } else {
            // Jika yang login adalah HR/Admin biasa, sembunyikan opsi HR (agar tidak bisa membuat HR baru)
            const optHr = document.getElementById("opt-hr");
            if(optHr) optHr.style.display = 'none'; 
        }
    }

    // Batasan menu lainnya jika bukan Super Admin
    if (!isSuperAdmin) {
        const btnKonfigCuti = document.getElementById("btn-konfigurasi-cuti");
        if (btnKonfigCuti) btnKonfigCuti.style.display = 'none'; // HR tidak boleh masuk ke Form Builder
        
        // Sembunyikan tab pengaturan jika bukan super admin
        const btnPengaturan = document.querySelector('button[data-bs-target="#tab-pengaturan"]');
        if (btnPengaturan) btnPengaturan.parentElement.style.display = 'none';
    }

    // Muat data awal
    loadSettings();
    loadDashboardStats();
    loadDataKantor();
    loadDataKaryawan();
    loadDataAbsensi();
    loadDataCuti();
    loadDataFormCuti();
    loadMasterCuti();

    // Initialize map when Tab Kantor is clicked
    const tabKantorBtn = document.querySelector('[data-bs-target="#tab-kantor"]');
    if (tabKantorBtn) {
        tabKantorBtn.addEventListener('shown.bs.tab', function () {
            initAdminMap();
            if (adminMap) adminMap.invalidateSize();
        });
    }

    // Real-time listener untuk semua tabel di Dashboard
    supabaseClient
      .channel('dashboard-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absensi' }, payload => {
          loadDashboardStats();
          loadDataAbsensi();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuti' }, payload => {
          loadDashboardStats();
          loadDataCuti();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => {
          loadDashboardStats();
          loadDataKaryawan();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kantor' }, payload => {
          loadDataKantor();
      })
      .subscribe();
});
let adminMap = null;
let adminMarker = null;
let adminCircle = null;

function initAdminMap() {
    const mapEl = document.getElementById('map-kantor');
    if (!mapEl) return;
    
    if (adminMap) {
        setTimeout(() => adminMap.invalidateSize(), 100);
        return;
    }
    
    adminMap = L.map('map-kantor').setView([-6.200000, 106.816666], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(adminMap);
    
    adminMap.on('click', function(e) {
        setMapLocation(e.latlng.lat, e.latlng.lng);
    });
}

function setMapLocation(lat, lng, updateInputs = true) {
    if (updateInputs) {
        document.getElementById('kantor_lat').value = parseFloat(lat).toFixed(6);
        document.getElementById('kantor_lng').value = parseFloat(lng).toFixed(6);
    }
    
    if (adminMarker) adminMap.removeLayer(adminMarker);
    adminMarker = L.marker([lat, lng]).addTo(adminMap);
    
    const radius = parseFloat(document.getElementById('kantor_rad').value) || 100;
    if (adminCircle) adminMap.removeLayer(adminCircle);
    adminCircle = L.circle([lat, lng], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.2,
        radius: radius
    }).addTo(adminMap);
    
    adminMap.setView([lat, lng], 16);
}

function gunakanLokasiSaatIni() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => setMapLocation(pos.coords.latitude, pos.coords.longitude),
            () => Swal.fire("Gagal", "Tidak dapat mengambil lokasi GPS.", "error"),
            { enableHighAccuracy: true }
        );
    } else {
        Swal.fire("Error", "Geolocation tidak didukung browser ini.", "error");
    }
}

// =====================================
// 1. DASHBOARD STATS
// =====================================
// =====================================
let attendanceChartInstance = null;
let dbHadirList = [];
let dbTerlambatList = [];
let dbCutiList = [];
let dbBelumList = [];

async function loadDashboardStats() {
    const today = new Date().toISOString().split('T')[0];
    
    // Set skeleton loader for stats
    document.getElementById("stat-hadir").innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
    document.getElementById("stat-terlambat").innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
    document.getElementById("stat-cuti").innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
    document.getElementById("stat-belum").innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';

    
    // 1. Fetch Total Users
    let qUser = supabaseClient.from('users').select('id, nama, cabang');
    if (!isSuperAdmin) qUser = qUser.eq('cabang', myCabang);
    const { data: usersData } = await qUser;
    const totalUsers = usersData ? usersData.length : 0;

    // 2. Fetch Absensi Hari Ini
    let qAbsen = supabaseClient.from('absensi').select('*, users!inner(id, nama, cabang)').eq('tanggal', today);
    if (!isSuperAdmin) qAbsen = qAbsen.eq('users.cabang', myCabang);
    const { data: absenData } = await qAbsen;
    
    dbHadirList = absenData || [];
    dbTerlambatList = dbHadirList.filter(a => a.status === 'Terlambat');
    
    const hadir = dbHadirList.length;
    const terlambat = dbTerlambatList.length;

    // 3. Fetch Cuti (Sedang Cuti & Pending)
    let qCuti = supabaseClient.from('cuti').select('*, users!inner(id, nama, cabang)');
    if (!isSuperAdmin) qCuti = qCuti.eq('users.cabang', myCabang);
    const { data: cutiData } = await qCuti;
    
    dbCutiList = [];
    let cutiPending = 0;
    
    if (cutiData) {
        cutiPending = cutiData.filter(c => c.status_pengajuan === 'Menunggu').length;
        dbCutiList = cutiData.filter(c => c.status_pengajuan === 'Disetujui' && c.tanggal_mulai <= today && c.tanggal_selesai >= today);
    }
    let sedangCuti = dbCutiList.length;

    // 4. Hitung Belum Absen
    dbBelumList = [];
    if (usersData) {
        usersData.forEach(u => {
            const isHadir = dbHadirList.some(a => a.users.id === u.id);
            const isCuti = dbCutiList.some(c => c.users.id === u.id);
            if (!isHadir && !isCuti) {
                dbBelumList.push(u);
            }
        });
    }
    const belumAbsen = dbBelumList.length;

    // Update UI Cards
    const safeSetText = (id, text) => { if(document.getElementById(id)) document.getElementById(id).innerText = text; };
    
    safeSetText("stat-hadir", hadir);
    safeSetText("stat-terlambat", terlambat);
    safeSetText("stat-cuti", sedangCuti);
    safeSetText("stat-belum", belumAbsen);
    
    // Cuti Pending Alert
    const pendingAlert = document.getElementById("alert-cuti-pending");
    if (pendingAlert) {
        if (cutiPending > 0) {
            pendingAlert.classList.remove("d-none");
            pendingAlert.classList.add("d-flex");
            safeSetText("stat-cuti-pending", cutiPending);
        } else {
            pendingAlert.classList.add("d-none");
            pendingAlert.classList.remove("d-flex");
        }
    }
    
    // Update menu badge
    const badgeCuti = document.getElementById("badge-cuti");
    if (badgeCuti) {
        if (cutiPending > 0) {
            badgeCuti.classList.remove("d-none");
            badgeCuti.innerText = cutiPending;
        } else {
            badgeCuti.classList.add("d-none");
        }
    }
    
    // 4. Render Pengumuman Markdown
    const pengumumanContainer = document.getElementById("dashboard-pengumuman-container");
    if (pengumumanContainer && window.marked) {
        const { data: settingData } = await supabaseClient.from('app_settings').select('pengumuman, pengumuman_warna').eq('id', 1).single();
        if (settingData && settingData.pengumuman) {
            const htmlContent = marked.parse(settingData.pengumuman);
            const colorClass = settingData.pengumuman_warna || 'alert-info';
            pengumumanContainer.innerHTML = `<div class="alert ${colorClass} shadow-sm">${htmlContent}</div>`;
        } else {
            pengumumanContainer.innerHTML = '<div class="text-muted text-center"><small>Belum ada pengumuman.</small></div>';
        }
    }

    // 5. Render Chart 7 Hari
    renderAttendanceChart();
}

function showDashboardDetail(type) {
    const titleEl = document.getElementById('modalDetailDashboardTitle');
    const headerEl = document.getElementById('modalDetailDashboardHeader');
    const tbody = document.getElementById('modalDetailDashboardBody');
    const extraCol = document.getElementById('modalDetailDashboardExtraCol');
    
    let dataList = [];
    
    headerEl.className = 'modal-header text-white'; // Reset class
    
    if (type === 'hadir') {
        titleEl.innerHTML = '<i class="fas fa-check-circle"></i> Karyawan Hadir Hari Ini';
        headerEl.classList.add('bg-success');
        extraCol.innerText = 'Jam Masuk';
        dataList = dbHadirList;
    } else if (type === 'terlambat') {
        titleEl.innerHTML = '<i class="fas fa-clock"></i> Karyawan Terlambat';
        headerEl.classList.add('bg-warning', 'text-dark');
        headerEl.classList.remove('text-white');
        extraCol.innerText = 'Jam Masuk';
        dataList = dbTerlambatList;
    } else if (type === 'cuti') {
        titleEl.innerHTML = '<i class="fas fa-suitcase-rolling"></i> Karyawan Sedang Cuti';
        headerEl.classList.add('bg-info');
        extraCol.innerText = 'Jenis Cuti';
        dataList = dbCutiList;
    } else if (type === 'belum') {
        titleEl.innerHTML = '<i class="fas fa-question-circle"></i> Karyawan Belum Absen';
        headerEl.classList.add('bg-secondary');
        extraCol.innerText = 'Status';
        dataList = dbBelumList;
    }
    
    tbody.innerHTML = '';
    
    if (dataList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Tidak ada data untuk ditampilkan.</td></tr>';
    } else {
        dataList.forEach(item => {
            let nama = '';
            let cabang = '';
            let info = '';
            
            if (type === 'hadir' || type === 'terlambat') {
                nama = item.users?.nama || '-';
                cabang = item.users?.cabang || '-';
                info = `<span class="badge bg-light text-dark border">${item.waktu_masuk || '-'}</span>`;
            } else if (type === 'cuti') {
                nama = item.users?.nama || '-';
                cabang = item.users?.cabang || '-';
                
                let jenis = 'Cuti';
                if (item.data_tambahan) {
                    // Coba cari key yang mengandung kata 'Jenis'
                    const keyJenis = Object.keys(item.data_tambahan).find(k => k.toLowerCase().includes('jenis'));
                    if (keyJenis) jenis = item.data_tambahan[keyJenis];
                }
                info = `<span class="badge bg-primary">${jenis}</span>`;
            } else if (type === 'belum') {
                nama = item.nama || '-';
                cabang = item.cabang || '-';
                info = `<span class="text-muted fst-italic">Belum Absen</span>`;
            }
            
            tbody.innerHTML += `
                <tr>
                    <td class="text-start ps-4 fw-bold">${nama}</td>
                    <td>${cabang}</td>
                    <td>${info}</td>
                </tr>
            `;
        });
    }
    
    new bootstrap.Modal(document.getElementById('modalDetailDashboard')).show();
}

async function renderAttendanceChart() {
    const canvas = document.getElementById('attendanceChart');
    if (!canvas) return;

    // Generate 7 days labels
    const labels = [];
    const dates = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
        labels.push(d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }));
    }

    // Fetch 7 days data
    let qChart = supabaseClient.from('absensi').select('tanggal, status, users!inner(id, nama, cabang)')
        .gte('tanggal', dates[0])
        .lte('tanggal', dates[6]);
        
    if (!isSuperAdmin) qChart = qChart.eq('users.cabang', myCabang);
    const { data: chartData } = await qChart;
    
    const tepatWaktuData = Array(7).fill(0);
    const terlambatData = Array(7).fill(0);

    if (chartData) {
        chartData.forEach(row => {
            const index = dates.indexOf(row.tanggal);
            if (index !== -1) {
                if (row.status === 'Terlambat') {
                    terlambatData[index]++;
                } else {
                    tepatWaktuData[index]++;
                }
            }
        });
    }

    if (attendanceChartInstance) {
        attendanceChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    attendanceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Tepat Waktu',
                    data: tepatWaktuData,
                    backgroundColor: '#198754',
                    borderRadius: 4
                },
                {
                    label: 'Terlambat',
                    data: terlambatData,
                    backgroundColor: '#ffc107',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

// =====================================
// 2. KELOLA KANTOR
// =====================================
let allKantor = [];
let currentKantorView = 'grid';

function toggleKantorView(view) {
    currentKantorView = view;
    document.getElementById('btn-kantor-grid').classList.toggle('active', view === 'grid');
    document.getElementById('btn-kantor-table').classList.toggle('active', view === 'table');

    if (view === 'grid') {
        document.getElementById('kantor-grid-container').classList.remove('d-none');
        document.getElementById('kantor-table-container').classList.add('d-none');
    } else {
        document.getElementById('kantor-grid-container').classList.add('d-none');
        document.getElementById('kantor-table-container').classList.remove('d-none');
    }
}

async function loadDataKantor() {
    let queryKantor = supabaseClient.from('kantor').select('*').order('nama', { ascending: true });
    if (!isSuperAdmin) {
        queryKantor = queryKantor.eq('nama', myCabang); // HR hanya bisa melihat cabangnya
        
        // Ubah UI form untuk mode Edit saja
        document.getElementById('kantor-card-header').innerText = '✏️ Edit Informasi Koordinat Cabang Anda';
        const namaInput = document.getElementById('kantor_nama');
        if(namaInput) namaInput.disabled = true; // Jangan boleh ganti nama cabang
        const btnTambah = document.getElementById('btn-tambah-kantor');
        if(btnTambah) btnTambah.style.display = 'none'; // Sembunyikan tombol tambah
    } else {
        const headerEl = document.getElementById('kantor-card-header');
        if(headerEl) headerEl.innerText = '➕ Tambah Kantor Baru / Edit';
    }

    const { data, error } = await queryKantor;
    if (error) {
        Swal.fire('Error', 'Gagal memuat data kantor', 'error');
        return;
    }
    
    allKantor = data || [];
    renderKantor();
}

function renderKantor() {
    const gridContainer = document.getElementById('kantor-grid-container');
    const tableBody = document.getElementById('kantor-table-body');
    const searchInput = document.getElementById('search-kantor');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    gridContainer.innerHTML = '';
    tableBody.innerHTML = '';

    const filtered = allKantor.filter(k => (k.nama || '').toLowerCase().includes(searchTerm));

    if (filtered.length === 0) {
        gridContainer.innerHTML = `<div class="col-12"><div class="alert alert-light text-center border">Belum ada data kantor / Tidak ditemukan.</div></div>`;
        tableBody.innerHTML = `<tr><td colspan="4" class="text-muted py-4">Belum ada data kantor / Tidak ditemukan.</td></tr>`;
        return;
    }

    filtered.forEach(kantor => {
        const hapusBtnGrid = isSuperAdmin ? `<button class="btn btn-sm btn-danger ms-2 shadow-sm" onclick="hapusKantor('${kantor.id}')"><i class="fas fa-trash me-1"></i>Hapus</button>` : '';
        const hapusBtnTable = isSuperAdmin ? `<button class="btn btn-sm btn-danger ms-1" onclick="hapusKantor('${kantor.id}')">Hapus</button>` : '';
        
        const argsStr = `'${kantor.id}', '${kantor.nama}', '${kantor.lat}', '${kantor.lng}', '${kantor.radius}'`;

        // Render Grid
        gridContainer.innerHTML += `
            <div class="col-md-6 col-lg-4">
                <div class="card shadow-sm h-100 border-0 dashboard-card-hover" style="border-radius: 12px; transition: transform 0.2s;">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="card-title fw-bold text-primary mb-0"><i class="fas fa-building me-2"></i>${kantor.nama}</h5>
                        </div>
                        <p class="card-text small text-muted mb-2">
                            <i class="fas fa-map-marker-alt me-2 text-danger"></i>${kantor.lat}, ${kantor.lng} (Rad: ${kantor.radius}m)
                        </p>
                        </div>
                        <div class="d-flex justify-content-end mt-auto border-top pt-2">
                            <button class="btn btn-sm btn-warning shadow-sm" onclick="editKantor(${argsStr})"><i class="fas fa-edit me-1"></i>Edit</button>
                            ${hapusBtnGrid}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Render Table
        tableBody.innerHTML += `
            <tr>
                <td class="fw-bold">${kantor.nama}</td>
                <td>${kantor.lat}, ${kantor.lng} <br> <span class="badge bg-secondary">Rad: ${kantor.radius}m</span></td>
                <td></td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="editKantor(${argsStr})">Edit</button>
                    ${hapusBtnTable}
                </td>
            </tr>
        `;
    });
}

function editKantor(id, nama, lat, lng, rad) {
    document.getElementById('kantor_id').value = id;
    document.getElementById('kantor_nama').value = nama;
    document.getElementById('kantor_rad').value = rad;
    document.getElementById('kantor_btn').innerText = 'Update Data Cabang';
    document.getElementById('kantor-card-header').innerText = '✏️ Edit Data Kantor';

    // Simpan koordinat di atribut modal untuk digunakan saat event shown
    const modalEl = document.getElementById('modalKantor');
    modalEl.dataset.lat = lat || '';
    modalEl.dataset.lng = lng || '';

    // Buka Modal dengan instance global atau baru
    const modalKantor = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalKantor.show();
}

function batalEditKantor() {
    document.getElementById('form-kantor').reset();
    document.getElementById('kantor_id').value = '';
    document.getElementById('kantor_btn').innerText = 'Simpan Data Cabang';
    document.getElementById('kantor-card-header').innerText = '➕ Tambah Kantor Baru';
    if (adminMarker) adminMap.removeLayer(adminMarker);
    if (adminCircle) adminMap.removeLayer(adminCircle);
    adminMarker = null;
    adminCircle = null;
    
    const modalEl = document.getElementById('modalKantor');
    modalEl.dataset.lat = '';
    modalEl.dataset.lng = '';
}

// Ensure map is correctly rendered when modal is opened for 'Tambah Baru'
document.addEventListener('DOMContentLoaded', () => {
    const modalEl = document.getElementById('modalKantor');
    if (modalEl) {
        modalEl.addEventListener('shown.bs.modal', () => {
            initAdminMap();
            
            const lat = modalEl.dataset.lat;
            const lng = modalEl.dataset.lng;
            
            if (lat && lng) {
                setMapLocation(lat, lng);
            } else if (!adminMarker) {
                // Mode Tambah Baru: otomatis cari lokasi saat ini agar tidak stuck di Jakarta
                gunakanLokasiSaatIni();
            }
            
            if (adminMap) {
                setTimeout(() => adminMap.invalidateSize(), 200);
            }
        });
    }

    ['kantor_lat', 'kantor_lng', 'kantor_rad'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                const lat = parseFloat(document.getElementById('kantor_lat').value);
                const lng = parseFloat(document.getElementById('kantor_lng').value);
                if (!isNaN(lat) && !isNaN(lng) && adminMap) {
                    setMapLocation(lat, lng, false);
                }
            });
        }
    });
});

async function simpanKantor(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    
    const id = document.getElementById('kantor_id').value;
    const nama = document.getElementById('kantor_nama').value;
    const lat = document.getElementById('kantor_lat').value;
    const lng = document.getElementById('kantor_lng').value;
    const rad = document.getElementById('kantor_rad').value;
    let res;
    if (id) {
        res = await supabaseClient.from('kantor').update({
            nama: nama,
            lat: lat,
            lng: lng,
            radius: rad
        }).eq('id', id);
    } else {
        res = await supabaseClient.from('kantor').insert([
            { 
              nama: nama, lat: lat, lng: lng, radius: rad
            }
        ]);
    }
    
    btn.disabled = false;
    
    if (res.error) {
        Swal.fire("Gagal", res.error.message, "error");
        return;
    }
    
    Swal.fire("Sukses", "Data kantor berhasil disimpan!", "success");
    batalEditKantor();
    loadDataKantor();
    
    // Tutup modal
    const modalKantorEl = document.getElementById('modalKantor');
    const modalKantor = bootstrap.Modal.getInstance(modalKantorEl);
    if (modalKantor) {
        modalKantor.hide();
    }
}

async function hapusKantor(id) {
    const result = await Swal.fire({
        title: "Konfirmasi Hapus",
        text: "Yakin ingin menghapus kantor ini?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;

    // Perbaikan: Ubah 'users' menjadi 'kantor' dan sesuaikan notifikasi
    await supabaseClient.from('kantor').delete().eq('id', id);
    Swal.fire(
        "Terhapus", 
        "Data kantor berhasil dihapus.", 
        "success"
    );
    // Perbaikan: Muat ulang data kantor, bukan karyawan
    loadDataKantor();
}


// =====================================
// 3. KELOLA KARYAWAN
// =====================================
let allKaryawan = [];
let karyawanViewMode = 'grid';

async function loadDataKaryawan() {
    const grid = document.getElementById("karyawan-grid-container");
    if (!grid) return;
    grid.innerHTML = '<div class="col-12 text-center">Memuat data...</div>';
    let queryUser = supabaseClient.from('users').select('*').order('nama', { ascending: true });
    if (!isSuperAdmin) {
        queryUser = queryUser.eq('cabang', myCabang);
    }
    const { data, error } = await queryUser;
    
    if (error) return;

    if (data.length === 0) {
        grid.innerHTML = '<div class="col-12 text-center text-muted">Belum ada data pengguna</div>';
        return;
    }

    // Populate dropdown cabang pada form tambah karyawan
    const { data: dataKantor } = await supabaseClient.from('kantor').select('nama');
    const selectCabang = document.getElementById("pilih-cabang");
    if(selectCabang) {
        selectCabang.innerHTML = '<option value="">Pilih Kantor...</option>';
        dataKantor?.forEach(k => {
            if (!isSuperAdmin && k.nama !== myCabang) return; // HR hanya melihat cabangnya sendiri
            selectCabang.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
        });
        
        // Pilih otomatis jika bukan super admin
        if (!isSuperAdmin) {
            selectCabang.value = myCabang;
            selectCabang.disabled = true; // Kunci pilihan agar HR tidak bisa menggantinya lewat inspector
        }
    }

    // Populate filter dropdown cabang
    const filterCabang = document.getElementById("karyawan-filter-cabang");
    if (filterCabang) {
        filterCabang.innerHTML = '<option value="">Semua Cabang</option>';
        dataKantor?.forEach(k => {
            if (!isSuperAdmin && k.nama !== myCabang) return;
            filterCabang.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
        });
    }

    allKaryawan = data;
    renderKaryawan();
}

function setKaryawanView(mode) {
    karyawanViewMode = mode;
    document.getElementById("btn-view-grid").classList.toggle("active", mode === 'grid');
    document.getElementById("btn-view-table").classList.toggle("active", mode === 'table');
    renderKaryawan();
}

function renderKaryawan() {
    const grid = document.getElementById("karyawan-grid-container");
    const tableContainer = document.getElementById("karyawan-table-container");
    const tbody = document.getElementById("karyawan-tbody");
    
    if (!grid || !tbody) return;
    
    const searchVal = (document.getElementById("karyawan-search")?.value || "").toLowerCase();
    const filterRole = document.getElementById("karyawan-filter-role")?.value || "";
    const filterCabang = document.getElementById("karyawan-filter-cabang")?.value || "";

    const filtered = allKaryawan.filter(u => {
        const matchSearch = u.nama.toLowerCase().includes(searchVal);
        const matchRole = filterRole === "" || u.role === filterRole;
        const matchCabang = filterCabang === "" || u.cabang === filterCabang;
        return matchSearch && matchRole && matchCabang;
    });

    if (karyawanViewMode === 'grid') {
        grid.classList.remove('d-none');
        tableContainer.classList.add('d-none');
        
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Tidak ada pengguna yang cocok.</div>';
            return;
        }

        grid.innerHTML = '';
        filtered.forEach(user => {
            const badgeColor = user.role === 'HR' ? 'primary' : (user.role === 'Super Admin' ? 'danger' : 'secondary');
            grid.innerHTML += `
                <div class="col-md-6 col-lg-4 col-xl-3">
                    <div class="card h-100 shadow-sm border-0 user-card-hover" style="transition: transform 0.2s;">
                        <div class="card-body" style="cursor: pointer;" onclick="showDetailKaryawan('${user.id}')">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <span class="badge bg-${badgeColor} text-white">${user.role}</span>
                                <small class="text-muted text-end">
                                    <i class="fas fa-building text-secondary"></i> ${user.cabang || '-'}
                                </small>
                            </div>
                            <h6 class="card-title fw-bold mb-1">${user.nama}</h6>
                        </div>
                    </div>
                </div>
            `;
        });
    } else {
        grid.classList.add('d-none');
        tableContainer.classList.remove('d-none');
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Tidak ada pengguna yang cocok.</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        filtered.forEach(user => {
            const badgeColor = user.role === 'HR' ? 'primary' : (user.role === 'Super Admin' ? 'danger' : 'secondary');
            tbody.innerHTML += `
                <tr>
                    <td>${user.nama}</td>
                    <td><span class="badge bg-${badgeColor} text-white">${user.role}</span></td>
                    <td>${user.no_hp || '-'}</td>
                    <td>${user.cabang || '-'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="showDetailKaryawan('${user.id}')">Detail</button>
                    </td>
                </tr>
            `;
        });
    }
}

function showDetailKaryawan(id) {
    const user = allKaryawan.find(u => u.id == id);
    if (!user) return;
    
    document.getElementById("detail_nama").innerText = user.nama;
    
    const badgeColor = user.role === 'HR' ? 'primary' : (user.role === 'Super Admin' ? 'danger' : 'secondary');
    document.getElementById("detail_role").className = `badge bg-${badgeColor} text-white mb-3`;
    document.getElementById("detail_role").innerText = user.role;
    
    document.getElementById("detail_cabang").innerText = user.cabang || '-';
    document.getElementById("detail_hp").innerText = user.no_hp || '-';
    
    const namaHariLibur = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    let liburTeks = "Tidak Ada";
    if (user.hari_libur) {
        const arrLibur = user.hari_libur.split(',').map(Number);
        const strLibur = arrLibur.map(d => namaHariLibur[d]).join(', ');
        if (strLibur) liburTeks = strLibur;
    }
    document.getElementById("detail_libur").innerText = liburTeks;
    
    // Tampilkan foto wajah di detail
    const detailFoto = document.getElementById("detail_foto_wajah");
    if (user.foto_wajah) {
        detailFoto.innerHTML = `<img src="${user.foto_wajah}" class="img-fluid rounded-circle shadow-sm" style="width: 120px; height: 120px; object-fit: cover; border: 3px solid #dee2e6;" alt="Wajah">`;
        detailFoto.classList.remove('d-none');
    } else {
        detailFoto.classList.add('d-none');
    }
    
    // Set button click handlers
    document.getElementById("btn-detail-edit").onclick = () => {
        document.activeElement.blur();
        bootstrap.Modal.getInstance(document.getElementById('modalDetailKaryawan')).hide();
        editKaryawan(user.id, user.nama, user.role, user.no_hp || '', user.cabang || '');
    };
    
    document.getElementById("btn-detail-hapus").onclick = () => {
        document.activeElement.blur();
        bootstrap.Modal.getInstance(document.getElementById('modalDetailKaryawan')).hide();
        hapusKaryawan(user.id);
    };


    new bootstrap.Modal(document.getElementById('modalDetailKaryawan')).show();
}

async function simpanKaryawan(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const id = document.getElementById("karyawan_id").value;
    const roleEl = document.getElementById("role-karyawan");
    const role = roleEl.value;
    const nama = document.getElementById("karyawan_nama").value;
    const no_hp = document.getElementById("karyawan_hp").value;
    const password = document.getElementById("karyawan_password").value;
    const cabang = document.getElementById("pilih-cabang").value;
    
    const liburCheckboxes = document.querySelectorAll('.form-libur-baru');
    const checkedLibur = Array.from(liburCheckboxes).filter(c => c.checked).map(c => c.value).join(',');

    let res;
    if (id) {
        // Edit Mode
        const updateData = { nama, no_hp, cabang, hari_libur: checkedLibur };
        
        // Super Admin boleh ubah role
        if (isSuperAdmin) {
            updateData.role = role;
        }
        
        let { data, error } = await supabaseClient.from('users').update(updateData).eq('id', id);
        
        // Hanya update password jika diisi
        if (password.trim() !== '') {
            const { error: rpcError } = await supabaseClient.rpc('admin_change_password', {
                p_user_id: id,
                p_new_password: password
            });
            if (rpcError) error = rpcError;
        }
        res = { error };
    } else {
        // Insert Mode (Karyawan Baru)
        if (!password) {
            Swal.fire("Gagal", "Password wajib diisi untuk karyawan baru", "error");
            btn.disabled = false;
            return;
        }
        
        // Pendaftaran profil ke database (Akun Auth akan dibuat otomatis saat login pertama)
        res = await supabaseClient.from('users').insert([
            { nama, password, role, no_hp, cabang, hari_libur: checkedLibur, sisa_cuti: 12 }
        ]);
    }

    btn.disabled = false;
    if (res.error) return Swal.fire("Gagal", res.error.message, "error");
    
    Swal.fire("Sukses", `Data Karyawan berhasil ${id ? 'diperbarui' : 'ditambahkan'}!`, "success");
    batalEditKaryawan();
    loadDataKaryawan();
    
    const modalEl = document.getElementById('modalKaryawan');
    const modalK = bootstrap.Modal.getInstance(modalEl);
    if (modalK) modalK.hide();
}

function editKaryawan(id, nama, role, no_hp, cabang) {
    document.getElementById("karyawan_id").value = id;
    document.getElementById("karyawan_nama").value = nama;
    document.getElementById("karyawan_hp").value = no_hp;
    document.getElementById("role-karyawan").value = role;
    
    const selectCabang = document.getElementById("pilih-cabang");
    if (cabang) selectCabang.value = cabang;
    
    document.getElementById("karyawan_password").value = ''; // Kosongkan password
    document.getElementById("karyawan_password").placeholder = "Isi jika ingin ganti password";
    
    // Setup checkboxes untuk hari libur
    const user = allKaryawan.find(u => u.id == id);
    const arrLibur = user && user.hari_libur ? user.hari_libur.split(',') : [];
    document.querySelectorAll('.form-libur-baru').forEach(cb => {
        cb.checked = arrLibur.includes(cb.value);
    });
    
    // Tampilkan foto wajah jika ada
    const containerWajah = document.getElementById("foto-wajah-container");
    const btnResetWajah = document.getElementById("btn-reset-wajah");
    if (user && user.foto_wajah) {
        containerWajah.innerHTML = `<img src="${user.foto_wajah}" class="img-fluid rounded shadow-sm" style="max-height: 120px;" alt="Wajah Karyawan">`;
        btnResetWajah.classList.remove('d-none');
    } else {
        containerWajah.innerHTML = `<span class="text-muted small">Belum terdaftar</span>`;
        btnResetWajah.classList.add('d-none');
    }
    
    document.getElementById("karyawan-card-header").innerText = "✏️ Edit Data Pengguna";
    document.getElementById("karyawan_btn").innerText = "Update Data";
    
    // Batasi perubahan role jika bukan Super Admin
    if (!isSuperAdmin) {
        document.getElementById("role-karyawan").disabled = true;
    }
    
    const modalK = new bootstrap.Modal(document.getElementById('modalKaryawan'));
    modalK.show();
}

function batalEditKaryawan() {
    document.getElementById("form-karyawan").reset();
    document.getElementById("karyawan_id").value = '';
    document.getElementById("karyawan_password").placeholder = "Password (Wajib)";
    
    document.querySelectorAll('.form-libur-baru').forEach(cb => cb.checked = false);
    document.getElementById("role-karyawan").value = "";
    document.getElementById("karyawan-card-header").innerText = "➕ Tambah Pengguna Baru";
    document.getElementById("karyawan_btn").innerText = "Simpan Data";
    
    const containerWajah = document.getElementById("foto-wajah-container");
    const btnResetWajah = document.getElementById("btn-reset-wajah");
    if (containerWajah) {
        containerWajah.innerHTML = `<span class="text-muted small">Belum terdaftar</span>`;
    }
    if (btnResetWajah) {
        btnResetWajah.classList.add('d-none');
    }
    
    if (!isSuperAdmin) {
        document.getElementById("role-karyawan").disabled = false;
        const selectCabang = document.getElementById("pilih-cabang");
        selectCabang.value = myCabang;
        selectCabang.disabled = true;
    }
}

async function hapusKaryawan(id) {
    const result = await Swal.fire({
        title: "Konfirmasi Hapus",
        text: "Yakin ingin menghapus karyawan ini?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;

    await supabaseClient.from('users').delete().eq('id', id);
    Swal.fire("Terhapus", "Data pengguna berhasil dihapus.", "success");
    loadDataKaryawan();
}

async function editHariLibur(id, nama, currentLibur) {
    const arrLibur = currentLibur ? currentLibur.split(',') : [];
    const isChecked = (val) => arrLibur.includes(val.toString()) ? 'checked' : '';

    const { value: selectedDays } = await Swal.fire({
        title: `Atur Jadwal Libur - ${nama}`,
        html: `
            <div class="text-start">
                <p class="text-muted small">Pilih hari libur rutin (tidak akan dihitung sebagai hari cuti):</p>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="1" ${isChecked(1)}> <label>Senin</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="2" ${isChecked(2)}> <label>Selasa</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="3" ${isChecked(3)}> <label>Rabu</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="4" ${isChecked(4)}> <label>Kamis</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="5" ${isChecked(5)}> <label>Jumat</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="6" ${isChecked(6)}> <label>Sabtu</label></div>
                <div class="form-check"><input class="form-check-input chk-libur" type="checkbox" value="0" ${isChecked(0)}> <label class="text-danger">Minggu</label></div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        preConfirm: () => {
            const checkboxes = document.querySelectorAll('.chk-libur:checked');
            const values = Array.from(checkboxes).map(c => c.value);
            return values.join(',');
        }
    });

    if (selectedDays !== undefined) {
        await supabaseClient.from('users').update({ hari_libur: selectedDays }).eq('id', id);
        Swal.fire("Berhasil", "Jadwal libur diperbarui.", "success");
        loadDataKaryawan();
    }
}

// =====================================
// 4. DATA ABSENSI
// =====================================
let allAbsensiGrouped = {};
let allCutiGrouped = {};
let currentDetailCutiRecords = [];
let currentDetailCutiRenderCount = 0;
let observerCuti = null;
let globalFormConfig = [];

async function loadDataAbsensi() {
    const gridContainer = document.getElementById("absensi-grid-container");
    const filterBulan = document.getElementById("filter-bulan-absensi");
    
    // Set default filter ke bulan ini jika kosong
    if (!filterBulan.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        filterBulan.value = `${yyyy}-${mm}`;
    }

    const [year, month] = filterBulan.value.split('-');
    const startDate = `${year}-${month}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const getSkeletonCardHTML = () => `
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card shadow-sm border-0 rounded-3 placeholder-glow">
                <div class="card-header bg-white border-0 pt-3 pb-0">
                    <h6 class="placeholder col-6"></h6>
                </div>
                <div class="card-body">
                    <div class="d-flex justify-content-between mb-3">
                        <span class="placeholder col-3"></span>
                        <span class="placeholder col-3"></span>
                        <span class="placeholder col-3"></span>
                    </div>
                    <div class="placeholder col-12" style="height: 30px;"></div>
                </div>
            </div>
        </div>
    `;

    gridContainer.innerHTML = Array(6).fill(getSkeletonCardHTML()).join('');

    let queryAbsen = supabaseClient.from('absensi').select('*, users!inner(nama, cabang)')
        .not('status', 'ilike', '%-TRASH-%')
        .gte('tanggal', startDate)
        .lte('tanggal', endDate)
        .order('tanggal', { ascending: false })
        .order('created_at', { ascending: false });
        
    if (!isSuperAdmin) {
        queryAbsen = queryAbsen.eq('users.cabang', myCabang);
    }
    
    const { data, error } = await queryAbsen;
    
    if (error) {
        console.error("Error Absensi:", error);
        gridContainer.innerHTML = `<div class="col-12"><div class="alert alert-danger">Gagal memuat absensi: ${error.message}</div></div>`;
        return;
    }

    if (!data || data.length === 0) {
        gridContainer.innerHTML = '<div class="col-12"><div class="alert alert-light text-center border">Belum ada data absensi di bulan ini.</div></div>';
        allAbsensiGrouped = {};
        return;
    }

    // Grouping by date
    allAbsensiGrouped = {};
    data.forEach(absen => {
        if (!allAbsensiGrouped[absen.tanggal]) {
            allAbsensiGrouped[absen.tanggal] = { records: [], hadir: 0, terlambat: 0, alpha: 0, cuti: 0 };
        }
        allAbsensiGrouped[absen.tanggal].records.push(absen);
        
        if (absen.status === 'Hadir') allAbsensiGrouped[absen.tanggal].hadir++;
        else if (absen.status === 'Terlambat') allAbsensiGrouped[absen.tanggal].terlambat++;
        else if (absen.status === 'Alpha') allAbsensiGrouped[absen.tanggal].alpha++;
        else if (absen.status === 'Cuti') allAbsensiGrouped[absen.tanggal].cuti++;
    });

    gridContainer.innerHTML = '';
    
    Object.keys(allAbsensiGrouped).forEach(tanggal => {
        const d = allAbsensiGrouped[tanggal];
        
        // Format Tanggal
        const dateObj = new Date(tanggal);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = dateObj.toLocaleDateString('id-ID', options);
        
        const totalAbsen = d.hadir + d.terlambat;

        gridContainer.innerHTML += `
            <div class="col-md-6 col-lg-4 col-xl-3">
                <div class="card shadow-sm h-100 border-0 dashboard-card-hover" style="border-radius: 12px; transition: transform 0.2s;">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-3">
                            <h6 class="card-title fw-bold text-primary mb-0"><i class="fas fa-calendar-day me-2"></i>${dateStr}</h6>
                        </div>
                        <div class="d-flex flex-column gap-2 mb-4">
                            <div class="d-flex justify-content-between align-items-center p-2 bg-light rounded">
                                <span class="text-muted small fw-bold">Total Masuk</span>
                                <span class="badge bg-primary rounded-pill">${totalAbsen} Orang</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center px-2">
                                <span class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i>Tepat Waktu</span>
                                <span class="fw-bold">${d.hadir}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center px-2">
                                <span class="text-muted small"><i class="fas fa-clock text-warning me-1"></i>Terlambat</span>
                                <span class="fw-bold">${d.terlambat}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center px-2 border-top pt-1 mt-1">
                                <span class="text-muted small"><i class="fas fa-umbrella-beach text-info me-1"></i>Cuti / Izin</span>
                                <span class="fw-bold">${d.cuti}</span>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-auto">
                            <button class="btn btn-sm btn-outline-primary w-50 fw-bold shadow-sm" onclick="showDetailAbsensi('${tanggal}', '${dateStr}')">
                                <i class="fas fa-list me-1"></i> Detail
                            </button>
                            <button class="btn btn-sm btn-success w-50 fw-bold shadow-sm" onclick="exportCsvHarian('${tanggal}')">
                                <i class="fas fa-download me-1"></i> Download
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    // Auto-refresh modal jika sedang terbuka
    const modalEl = document.getElementById("modalDetailAbsensi");
    if (modalEl && modalEl.classList.contains("show") && currentAbsensiTanggal) {
        showDetailAbsensi(currentAbsensiTanggal, currentAbsensiDateStr);
    }
}

let currentAbsensiTanggal = null;
let currentAbsensiDateStr = null;

function showDetailAbsensi(tanggal, dateStr) {
    currentAbsensiTanggal = tanggal;
    currentAbsensiDateStr = dateStr;
    const tbody = document.getElementById("modalDetailAbsensiBody");
    document.getElementById("modalDetailAbsensiTitle").innerHTML = `<i class="fas fa-calendar-day me-2"></i>Detail Absensi - ${dateStr}`;
    tbody.innerHTML = '';
    
    const records = allAbsensiGrouped[tanggal]?.records || [];
    
    records.forEach(absen => {
        const hasFoto = absen.foto;
        const fotoHTML = hasFoto 
            ? `<button class="btn btn-sm btn-info text-white shadow-sm" onclick="lihatFotoAbsenSingle('${absen.foto}')">📸 Lihat Foto</button>` 
            : `<span class="text-muted small fst-italic">Tidak tersedia</span>`;
            
        let badgeClass = "bg-secondary text-white";
        if (absen.status === "Hadir" || absen.status === "Tepat Waktu") badgeClass = "bg-success text-white";
        else if (absen.status === "Terlambat") badgeClass = "bg-warning text-dark";
        else if (absen.status === "Alpha") badgeClass = "bg-danger text-white";
        else if (absen.status === "Cuti") badgeClass = "bg-info text-dark";
        
        let faceBadgeClass = "bg-secondary text-white";
        const faceStatus = absen.status_wajah || "Sesuai";
        if (faceStatus.includes("Dicurigai") || faceStatus.includes("Tidak Sama")) faceBadgeClass = "bg-danger text-white";
        else if (faceStatus.includes("Sesuai") || faceStatus.includes("Sama")) faceBadgeClass = "bg-success text-white";
        else if (faceStatus.includes("Error")) faceBadgeClass = "bg-warning text-dark";

        const statusHTML = `
            <span class="badge ${badgeClass} fs-6 mb-1">${absen.status || 'Hadir'}</span><br>
            <span class="badge ${faceBadgeClass} mb-1" title="Status Pengenalan Wajah"><i class="fas fa-user-check"></i> ${faceStatus}</span>
        `;
            
        tbody.innerHTML += `
            <tr>
                <td class="text-start ps-3 fw-bold">${absen.users?.nama || 'Unknown'}</td>
                <td>${absen.users?.cabang || '-'}</td>
                <td><span class="badge bg-primary">${absen.tipe_absen || '-'}</span></td>
                <td>${absen.waktu || '-'}</td>
                <td><span class="small text-muted">${absen.lokasi || '-'}</span></td>
                <td>${fotoHTML}</td>
                <td>${statusHTML}</td>
                <td>
                    <button class="btn btn-sm btn-danger shadow-sm text-white" onclick="hapusDataAbsen('${absen.id}', '${tanggal}')">
                        <i class="fas fa-trash-alt me-1"></i>Hapus
                    </button>
                </td>
            </tr>
        `;
    });
    
    const modalEl = document.getElementById('modalDetailAbsensi');
    if (!modalEl.classList.contains('show')) {
        new bootstrap.Modal(modalEl).show();
    }
}

async function exportCsvHarian(tanggal) {
    try {
        const records = allAbsensiGrouped[tanggal]?.records || [];
        if (records.length === 0) return Swal.fire("Kosong", "Tidak ada data untuk diexport", "info");

        const result = await Swal.fire({
            title: 'Opsi Unduhan Absensi',
            html: `<p>Pilih format unduhan data absensi untuk tanggal <strong>${tanggal}</strong>.</p>`,
            icon: 'question',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-file-csv"></i> Unduh CSV Saja',
            confirmButtonColor: '#28a745',
            denyButtonText: '<i class="fas fa-file-archive"></i> CSV + Media (ZIP)',
            denyButtonColor: '#17a2b8',
            cancelButtonText: 'Batal',
            reverseButtons: true
        });

        if (!result.isConfirmed && !result.isDenied) return;

        const includeMedia = result.isDenied;

        let header = "Tanggal,Nama,Cabang,Waktu Masuk,Waktu Istirahat Keluar,Waktu Istirahat Masuk,Waktu Pulang,Status Kehadiran,Jarak (Meter)";
        if (includeMedia) {
            header += ",Link Foto Masuk,Link Foto Mulai Istirahat,Link Foto Selesai Istirahat,Link Foto Pulang";
        }
        
        let csvContent = header + "\n";
        const escapeCSV = (str) => '"' + String(str).replace(/"/g, '""') + '"';

        records.forEach(row => {
            let cols = [
                escapeCSV(row.tanggal),
                escapeCSV(row.users?.nama || 'Unknown'),
                escapeCSV(row.users?.cabang || '-'),
                escapeCSV(row.waktu_masuk || '-'),
                escapeCSV(row.waktu_istirahat_keluar || '-'),
                escapeCSV(row.waktu_istirahat_masuk || '-'),
                escapeCSV(row.waktu_keluar || '-'),
                escapeCSV(row.status || '-'),
                escapeCSV(row.jarak_meter || 0)
            ];
            
            if (includeMedia) {
                cols.push(
                    escapeCSV(row.foto_masuk || ''),
                    escapeCSV(row.foto_istirahat_keluar || ''),
                    escapeCSV(row.foto_istirahat_masuk || ''),
                    escapeCSV(row.foto_keluar || '')
                );
            }
            
            csvContent += cols.join(",") + "\n";
        });

        if (includeMedia) {
            Swal.fire({
                title: 'Menyiapkan File ZIP...',
                html: 'Sedang mengunduh foto absensi dari server. Mohon tunggu sebentar...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            try {
                if (typeof JSZip === 'undefined') {
                    throw new Error("Library JSZip belum dimuat sempurna. Harap refresh halaman.");
                }

                const zip = new JSZip();
                
                // Format folder utama (sama seperti menu Export)
                const folderName = tanggal.split('-').reverse().join('-');
                const rootFolder = zip.folder(folderName);
                
                // Tambahkan file CSV ke dalam root folder
                rootFolder.file(`rekap_absen.csv`, csvContent);
                
                // Folder media
                const mediaFolder = rootFolder.folder("media");
                
                const fetchFoto = async (url, folder, filename) => {
                    if (url && url.startsWith('http')) {
                        try {
                            const response = await fetch(url);
                            if (response.ok) {
                                const blob = await response.blob();
                                folder.file(filename, blob);
                            }
                        } catch(e) {
                            console.error("Gagal mendownload foto:", url, e);
                        }
                    }
                };

                for (const row of records) {
                    const namaUser = row.users ? row.users.nama : 'Unknown';
                    const userFolder = mediaFolder.folder(namaUser);
                    
                    await fetchFoto(row.foto_masuk, userFolder, `${tanggal}_Masuk.png`);
                    await fetchFoto(row.foto_istirahat_keluar, userFolder, `${tanggal}_IstirahatKeluar.png`);
                    await fetchFoto(row.foto_istirahat_masuk, userFolder, `${tanggal}_IstirahatMasuk.png`);
                    await fetchFoto(row.foto_keluar, userFolder, `${tanggal}_Keluar.png`);
                }

                const zipBlob = await zip.generateAsync({ type: "blob" });
                const link = document.createElement("a");
                const url = URL.createObjectURL(zipBlob);
                link.setAttribute("href", url);
                link.setAttribute("download", `Rekap_Absensi_${folderName}.zip`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                Swal.close();
            } catch (err) {
                console.error("ZIP Error:", err);
                Swal.fire("Error", "Gagal membuat file ZIP: " + err.message, "error");
            }
        } else {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `Data_Absensi_${tanggal}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    } catch(err) {
        console.error("Export Error:", err);
        Swal.fire("Error", "Gagal memproses export: " + err.message, "error");
    }
}

function lihatFotoAbsen(masuk, istKeluar, istMasuk, pulang) {
    let html = '<div class="d-flex flex-column gap-2 text-start">';
    
    if (masuk) html += `<button onclick="tampilkanPopupFoto('${masuk}', 'Masuk')" class="btn btn-outline-primary">📸 Foto Masuk</button>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Masuk (Belum ada)</button>`;
    
    if (istKeluar) html += `<button onclick="tampilkanPopupFoto('${istKeluar}', 'Mulai Istirahat')" class="btn btn-outline-info">📸 Foto Mulai Istirahat</button>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Mulai Istirahat (Belum ada)</button>`;
    
    if (istMasuk) html += `<button onclick="tampilkanPopupFoto('${istMasuk}', 'Selesai Istirahat')" class="btn btn-outline-info">📸 Foto Selesai Istirahat</button>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Selesai Istirahat (Belum ada)</button>`;
    
    if (pulang) html += `<button onclick="tampilkanPopupFoto('${pulang}', 'Pulang')" class="btn btn-outline-warning">📸 Foto Pulang</button>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Pulang (Belum ada)</button>`;
    
    html += '</div>';

    Swal.fire({
        title: "Dokumentasi Foto",
        html: html,
        showConfirmButton: true,
        confirmButtonText: "Tutup"
    });
}

function tampilkanPopupFoto(url, tipe) {
    Swal.fire({
        title: 'Foto ' + tipe,
        imageUrl: url,
        imageAlt: 'Foto ' + tipe,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-download"></i> Download',
        cancelButtonText: 'Tutup',
        showCloseButton: true,
        customClass: {
            image: 'img-fluid rounded',
        },
        showLoaderOnConfirm: true,
        preConfirm: () => {
            return fetch(url)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(response.statusText)
                    }
                    return response.blob()
                })
                .then(blob => {
                    const blobUrl = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = blobUrl;
                    link.download = `Foto_${tipe.replace(/\s+/g, '_')}_${new Date().getTime()}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(blobUrl);
                })
                .catch(error => {
                    Swal.showValidationMessage(`Gagal mendownload: ${error}`);
                });
        },
        allowOutsideClick: () => !Swal.isLoading()
    });
}

// =====================================
// 5. DATA CUTI
// =====================================
async function loadDataCuti() {
    const grid = document.getElementById("cuti-grid");
    if (!grid) return;
    
    const getSkeletonCardHTML = () => `
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card shadow-sm border-0 rounded-3 placeholder-glow">
                <div class="card-header bg-white border-0 pt-3 pb-0">
                    <h6 class="placeholder col-6"></h6>
                </div>
                <div class="card-body">
                    <div class="d-flex justify-content-between mb-3">
                        <span class="placeholder col-3"></span>
                        <span class="placeholder col-3"></span>
                        <span class="placeholder col-3"></span>
                    </div>
                    <div class="placeholder col-12" style="height: 30px;"></div>
                </div>
            </div>
        </div>
    `;
    grid.innerHTML = Array(6).fill(getSkeletonCardHTML()).join('');
    
    // Ambil konfigurasi form untuk header dinamis
    const { data: formConfig } = await supabaseClient.from('form_cuti_config').select('label').order('urutan', { ascending: true });
    globalFormConfig = formConfig ? formConfig.map(f => f.label) : [];

    let queryCuti = supabaseClient.from('cuti').select('*, users!inner(nama, cabang)').order('tanggal_mulai', { ascending: false });
    if (!isSuperAdmin) {
        queryCuti = queryCuti.eq('users.cabang', myCabang);
    }
    const { data, error } = await queryCuti;
    
    if (error || !data || data.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5 text-muted"><i class="fas fa-folder-open fs-1 mb-3"></i><br>Belum ada pengajuan cuti</div>`;
        return;
    }

    // Kelompokkan berdasarkan Bulan (YYYY-MM)
    allCutiGrouped = {};
    data.forEach(row => {
        if (!row.tanggal_mulai) return;
        const [year, month] = row.tanggal_mulai.split('-');
        const bulan = `${year}-${month}`;
        
        if (!allCutiGrouped[bulan]) {
            allCutiGrouped[bulan] = { records: [], menunggu: 0, disetujui: 0, ditolak: 0 };
        }
        allCutiGrouped[bulan].records.push(row);
        
        if (row.status_pengajuan === 'Menunggu') allCutiGrouped[bulan].menunggu++;
        else if (row.status_pengajuan === 'Disetujui') allCutiGrouped[bulan].disetujui++;
        else if (row.status_pengajuan === 'Ditolak') allCutiGrouped[bulan].ditolak++;
    });

    grid.innerHTML = '';
    
    const namaBulan = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const sortedBulan = Object.keys(allCutiGrouped).sort((a, b) => b.localeCompare(a));

    sortedBulan.forEach(bulan => {
        const d = allCutiGrouped[bulan];
        const [year, month] = bulan.split('-');
        const namaBln = `${namaBulan[parseInt(month)]} ${year}`;
        
        grid.innerHTML += `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="card h-100 shadow-sm border-0 rounded-3">
                    <div class="card-header bg-white border-0 pt-3 pb-0">
                        <h6 class="fw-bold mb-0 text-primary"><i class="fas fa-calendar-alt me-2"></i>${namaBln}</h6>
                    </div>
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between mb-3">
                            <div class="text-center">
                                <span class="d-block small text-muted">Menunggu</span>
                                <span class="fw-bold fs-5 text-warning">${d.menunggu}</span>
                            </div>
                            <div class="text-center">
                                <span class="d-block small text-muted">Disetujui</span>
                                <span class="fw-bold fs-5 text-success">${d.disetujui}</span>
                            </div>
                            <div class="text-center">
                                <span class="d-block small text-muted">Ditolak</span>
                                <span class="fw-bold fs-5 text-danger">${d.ditolak}</span>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-auto">
                            <button class="btn btn-sm btn-outline-primary w-50 fw-bold shadow-sm" onclick="showDetailCuti('${bulan}', '${namaBln}')">
                                <i class="fas fa-list me-1"></i> Detail
                            </button>
                            <button class="btn btn-sm btn-success w-50 fw-bold shadow-sm" onclick="exportCsvCuti('${bulan}')">
                                <i class="fas fa-download me-1"></i> Download
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    // Auto-refresh modal jika sedang terbuka
    const modalEl = document.getElementById("modalDetailCuti");
    if (modalEl && modalEl.classList.contains("show") && currentCutiBulan) {
        showDetailCuti(currentCutiBulan, currentCutiNamaBln);
    }
}

let currentCutiBulan = null;
let currentCutiNamaBln = null;

function showDetailCuti(bulan, namaBln) {
    currentCutiBulan = bulan;
    currentCutiNamaBln = namaBln;
    let titleHTML = `<i class="fas fa-calendar-alt me-2"></i>Detail Cuti - ${namaBln}`;
    const d = allCutiGrouped[bulan];
    if (d && d.menunggu > 0) {
        titleHTML += ` <button class="btn btn-sm btn-success ms-3 shadow-sm rounded-pill" onclick="setujuiSemuaCuti('${bulan}')"><i class="fas fa-check-double me-1"></i> Setujui Semua (${d.menunggu})</button>`;
    }
    document.getElementById("modalDetailCutiTitle").innerHTML = titleHTML;
    
    // Header
    let theadHTML = `
        <th>Nama Karyawan</th>
        <th>Tanggal Cuti</th>
    `;
    globalFormConfig.forEach(label => {
        theadHTML += `<th>${label}</th>`;
    });
    theadHTML += `
        <th>Durasi</th>
        <th>Aksi / Status</th>
    `;
    document.getElementById("thead-cuti-tr").innerHTML = theadHTML;
    
    const inputSearch = document.getElementById("inputSearchCuti");
    if(inputSearch) inputSearch.value = ""; // reset pencarian
    
    // Sort records: Menunggu di atas
    let records = allCutiGrouped[bulan]?.records || [];
    records.sort((a, b) => {
        if (a.status_pengajuan === 'Menunggu' && b.status_pengajuan !== 'Menunggu') return -1;
        if (a.status_pengajuan !== 'Menunggu' && b.status_pengajuan === 'Menunggu') return 1;
        return new Date(b.tanggal_mulai) - new Date(a.tanggal_mulai);
    });
    
    currentDetailCutiRecords = records;
    renderTableDetailCuti(true);
    
    const modalEl = document.getElementById('modalDetailCuti');
    if (!modalEl.classList.contains('show')) {
        new bootstrap.Modal(modalEl).show();
    }
    
    // Setup Observer
    if (!observerCuti) {
        observerCuti = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                renderTableDetailCuti(false);
            }
        }, { root: document.querySelector('#modalDetailCuti .modal-body'), margin: '100px' });
        observerCuti.observe(document.getElementById("sentinel-cuti"));
    }
}

function renderTableDetailCuti(reset = false) {
    const tbody = document.getElementById("modalDetailCutiBody");
    const sentinel = document.getElementById("sentinel-cuti");
    
    if (reset) {
        tbody.innerHTML = '';
        currentDetailCutiRenderCount = 0;
    }
    
    const query = (document.getElementById("inputSearchCuti")?.value || "").toLowerCase();
    
    // Filter
    let filtered = currentDetailCutiRecords;
    if (query) {
        filtered = currentDetailCutiRecords.filter(cuti => {
            const nama = (cuti.users?.nama || 'Unknown').toLowerCase();
            return nama.includes(query);
        });
    }
    
    const chunk = filtered.slice(currentDetailCutiRenderCount, currentDetailCutiRenderCount + 20);
    
    if (reset && filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">Data tidak ditemukan</td></tr>`;
        sentinel.style.display = "none";
        return;
    }

    let batchHTML = '';
    for (const cuti of chunk) {
        let aksiHTML = '';
        if (cuti.status_pengajuan === 'Menunggu') {
            aksiHTML = `
                <button class="btn btn-sm btn-success mb-1 w-100" onclick="prosesCuti('${cuti.id}', '${cuti.user_id}', ${cuti.durasi_hari}, 'Disetujui')">Setujui</button>
                <button class="btn btn-sm btn-danger mb-1 w-100" onclick="prosesCuti('${cuti.id}', null, null, 'Ditolak')">Tolak</button>
            `;
        } else {
            aksiHTML = `
                <span class="badge bg-${cuti.status_pengajuan === 'Disetujui' ? 'success' : 'danger'} d-block mb-1">${cuti.status_pengajuan}</span>
                <button class="btn btn-sm btn-outline-secondary w-100 mb-1" onclick="editStatusCuti('${cuti.id}', '${cuti.status_pengajuan}')">Edit Status</button>
            `;
        }
        aksiHTML += `<button class="btn btn-sm btn-outline-danger w-100" onclick="hapusCuti('${cuti.id}')">Hapus</button>`;

        let trHTML = `<tr>
            <td class="text-start fw-bold">${cuti.users?.nama || 'Unknown'}</td>
            <td>${cuti.tanggal_mulai} <br><span class="text-muted small">s/d</span><br> ${cuti.tanggal_selesai}</td>
        `;
        
        globalFormConfig.forEach(label => {
            let val = (cuti.data_tambahan && cuti.data_tambahan[label]) ? cuti.data_tambahan[label] : '-';
            if (val.toString().startsWith('http')) {
                val = `<button type="button" class="btn btn-sm btn-outline-info" onclick="previewFile('${val}')">Lihat File</button>`;
            }
            if (label.toLowerCase().includes('alasan') && val === '-' && cuti.alasan) {
                val = cuti.alasan;
            }
            trHTML += `<td>${val}</td>`;
        });

        trHTML += `
            <td class="text-center">${cuti.durasi_hari} Hari</td>
            <td style="min-width:120px;">${aksiHTML}</td>
        </tr>`;
        batchHTML += trHTML;
    }
    
    tbody.insertAdjacentHTML('beforeend', batchHTML);
    currentDetailCutiRenderCount += chunk.length;
    
    if (currentDetailCutiRenderCount >= filtered.length) {
        sentinel.style.display = "none";
    } else {
        sentinel.style.display = "block";
    }
}

function previewFile(url) {
    const frame = document.getElementById('previewFileFrame');
    const img = document.getElementById('previewImage');
    const btnDownload = document.getElementById('btnDownloadPreview');
    
    if (btnDownload) {
        btnDownload.href = url;
    }

    const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)$/i) || url.includes('alt=media');
    
    if (isImage) {
        if (frame) frame.style.display = 'none';
        if (img) {
            img.style.display = 'block';
            img.src = url;
        }
    } else {
        if (img) img.style.display = 'none';
        if (frame) {
            frame.style.display = 'block';
            frame.src = url;
        }
    }

    const modal = new bootstrap.Modal(document.getElementById('modalPreviewFile'));
    modal.show();
}

async function exportCsvCuti(bulan) {
    try {
        const records = allCutiGrouped[bulan]?.records || [];
        if (records.length === 0) return Swal.fire("Kosong", "Tidak ada data untuk diexport", "info");

        const { data: settingData } = await supabaseClient.from('app_settings').select('nama_aplikasi').eq('id', 1).single();
        const appName = settingData ? settingData.nama_aplikasi : "Aplikasi Absensi";

        // Format Header
        let headers = ["Nama Karyawan", "Cabang", "Tanggal Mulai", "Tanggal Selesai", "Durasi (Hari)", "Status"];
        globalFormConfig.forEach(label => headers.push(label));
        
        let csvContent = `Data Cuti - ${appName}\n`;
        csvContent += headers.join(",") + "\n";
        const escapeCSV = (str) => '"' + String(str).replace(/"/g, '""') + '"';

        records.forEach(cuti => {
            let cols = [
                escapeCSV(cuti.users?.nama || 'Unknown'),
                escapeCSV(cuti.users?.cabang || '-'),
                escapeCSV(cuti.tanggal_mulai || '-'),
                escapeCSV(cuti.tanggal_selesai || '-'),
                escapeCSV(cuti.durasi_hari || 0),
                escapeCSV(cuti.status_pengajuan || '-')
            ];
            
            globalFormConfig.forEach(label => {
                let val = (cuti.data_tambahan && cuti.data_tambahan[label]) ? cuti.data_tambahan[label] : '-';
                if (label.toLowerCase().includes('alasan') && val === '-' && cuti.alasan) {
                    val = cuti.alasan;
                }
                cols.push(escapeCSV(val));
            });
            
            csvContent += cols.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Rekap_Cuti_${bulan}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch(err) {
        console.error("Export Cuti Error:", err);
        Swal.fire("Error", "Gagal memproses export: " + err.message, "error");
    }
}

async function setujuiSemuaCuti(bulan) {
    const records = allCutiGrouped[bulan]?.records || [];
    const menunggu = records.filter(c => c.status_pengajuan === 'Menunggu');
    
    if (menunggu.length === 0) return;
    
    const result = await Swal.fire({
        title: "Konfirmasi",
        text: `Anda akan menyetujui ${menunggu.length} pengajuan cuti secara massal. Lanjutkan?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Ya, Setujui Semua",
        cancelButtonText: "Batal"
    });
    
    if (!result.isConfirmed) return;
    
    Swal.fire({ title: 'Memproses...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const ids = menunggu.map(c => c.id);
        for (const id of ids) {
            await supabaseClient.from('cuti').update({ status_pengajuan: 'Disetujui' }).eq('id', id);
        }
        
        Swal.fire("Berhasil", "Semua pengajuan cuti berhasil disetujui", "success");
        
        // Reload modal and grid
        const modalEl = document.getElementById('modalDetailCuti');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        
        loadDataCuti();
        loadDashboardStats(); // <-- DIPERBAIKI
    } catch(err) {
        Swal.fire("Error", "Gagal menyetujui semua: " + err.message, "error");
    }
}

async function prosesCuti(cuti_id, user_id, durasi, status) {
    const result = await Swal.fire({
        title: "Konfirmasi",
        text: `Yakin ingin mengubah status menjadi: ${status}?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: status === 'Disetujui' ? '#28a745' : '#d33',
        cancelButtonText: "Batal",
        confirmButtonText: `Ya, ${status}`
    });
    
    if (!result.isConfirmed) return;
    
    // Update status cuti
    await supabaseClient.from('cuti').update({ status_pengajuan: status }).eq('id', cuti_id);
    
    Swal.fire("Berhasil", `Cuti ${status}`, "success");
    loadDataCuti();
    loadDashboardStats(); // <-- DIPERBAIKI

    // <-- TAMBAHAN: Tutup modal agar UI merefresh data terbaru
    const modalEl = document.getElementById('modalDetailCuti');
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();
}

async function editStatusCuti(cuti_id, currentStatus) {
    const { value: statusBaru } = await Swal.fire({
        title: 'Ubah Status Cuti',
        input: 'select',
        inputOptions: {
            'Menunggu': 'Menunggu',
            'Disetujui': 'Disetujui',
            'Ditolak': 'Ditolak'
        },
        inputValue: currentStatus,
        showCancelButton: true,
        confirmButtonText: 'Simpan Perubahan'
    });

    if (statusBaru && statusBaru !== currentStatus) {
        await supabaseClient.from('cuti').update({ status_pengajuan: statusBaru }).eq('id', cuti_id);
        Swal.fire('Berhasil', 'Status cuti telah diperbarui.', 'success');
        
        loadDataCuti();
        loadDashboardStats(); // <-- DIPERBAIKI
        
        // <-- TAMBAHAN: Tutup modal agar UI merefresh data terbaru
        const modalEl = document.getElementById('modalDetailCuti');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
    }
}

async function hapusCuti(cuti_id) {
    const result = await Swal.fire({
        title: "Konfirmasi Hapus",
        text: "Peringatan: Data pengajuan cuti ini akan dihapus permanen. Lanjutkan?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;
    
    await supabaseClient.from('cuti').delete().eq('id', cuti_id);
    Swal.fire('Terhapus', 'Data cuti berhasil dihapus.', 'success');
    loadDataCuti();
}

// =====================================
// 6. FORM BUILDER CUTI
// =====================================
let formCutiModalInstance = null;

function showModalFormCuti(id = '') {
    const el = document.getElementById('modalFormBuilder');
    if(!formCutiModalInstance) formCutiModalInstance = new bootstrap.Modal(el);
    
    document.getElementById('modalFormBuilderLabel').innerText = 'Tambah Field Cuti';
    document.getElementById('field-id').value = id;
    if(!id) {
        document.getElementById('field-label').value = '';
        document.getElementById('field-tipe').value = 'keterangan';
        document.getElementById('field-opsi').value = '';
        document.getElementById('field-wajib').value = 'true';
        toggleOpsiDropdown();
    }
    formCutiModalInstance.show();
}

function toggleOpsiDropdown() {
    const tipe = document.getElementById('field-tipe').value;
    const container = document.getElementById('container-opsi');
    const label = document.getElementById('label-opsi');
    const input = document.getElementById('field-opsi');
    const hint = document.getElementById('hint-opsi');
    
    container.style.display = 'block';
    if(tipe === 'dropdown') {
        label.innerText = 'Opsi Pilihan (Pisahkan dengan koma)';
        input.placeholder = 'Opsi A, Opsi B, Opsi C';
        hint.innerText = 'Untuk dropdown, pisahkan opsi dengan koma.';
    } else {
        label.innerText = 'Kondisi Tampil (Opsional)';
        input.placeholder = 'Contoh: Jenis Cuti=Sakit|Lainnya';
        hint.innerText = 'Gunakan | (Pipa) untuk lebih dari 1 kondisi. Cth: Field=Nilai1|Nilai2';
    }
}

async function loadDataFormCuti() {
    const tbody = document.querySelector("#tabel-form-builder tbody");
    if(!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from('form_cuti_config').select('*').order('urutan', { ascending: true });
    if (error) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-danger">Tabel form_cuti_config belum dibuat. Silakan eksekusi file SQL.</td></tr>';
        return;
    }
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Belum ada konfigurasi form.</td></tr>';
        return;
    }

    // Simpan data di memori agar bisa diedit tanpa request ulang
    window.formCutiConfigData = data;

    tbody.innerHTML = '';
    data.forEach((f, index) => {
        tbody.innerHTML += `
            <tr>
                <td>${f.label}</td>
                <td><span class="badge bg-secondary">${f.tipe}</span></td>
                <td>${f.opsi ? f.opsi : '-'}</td>
                <td>${f.wajib ? 'Wajib' : 'Opsional'}</td>
                <td>
                    <div class="btn-group me-2" role="group">
                        <button class="btn btn-sm btn-light border" onclick="moveUrutanCuti('${f.id}', -1)" title="Naik" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                        <button class="btn btn-sm btn-light border" onclick="moveUrutanCuti('${f.id}', 1)" title="Turun" ${index === data.length - 1 ? 'disabled' : ''}>⬇️</button>
                    </div>
                    <button class="btn btn-sm btn-outline-primary" onclick="editFieldCuti('${f.id}')">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="hapusFieldCuti('${f.id}')">Hapus</button>
                </td>
            </tr>
        `;
    });
}

function editFieldCuti(id) {
    if(!window.formCutiConfigData) return;
    const f = window.formCutiConfigData.find(item => item.id == id);
    if(!f) return;

    const el = document.getElementById('modalFormBuilder');
    if(!formCutiModalInstance) formCutiModalInstance = new bootstrap.Modal(el);

    document.getElementById('field-id').value = f.id;
    document.getElementById('field-label').value = f.label;
    document.getElementById('field-tipe').value = f.tipe;
    document.getElementById('field-opsi').value = f.opsi || '';
    document.getElementById('field-wajib').value = f.wajib ? 'true' : 'false';
    
    toggleOpsiDropdown();
    
    document.getElementById('modalFormBuilderLabel').innerText = 'Edit Field Cuti';
    formCutiModalInstance.show();
}

async function simpanFieldCuti(event) {
    event.preventDefault();
    const id = document.getElementById('field-id').value;
    const label = document.getElementById('field-label').value;
    const tipe = document.getElementById('field-tipe').value;
    const opsi = document.getElementById('field-opsi').value;
    const wajib = document.getElementById('field-wajib').value === 'true';

    let payload = { label, tipe, opsi, wajib };
    let res;

    if (id) {
        res = await supabaseClient.from('form_cuti_config').update(payload).eq('id', id);
    } else {
        let nextUrutan = 1;
        if (window.formCutiConfigData && window.formCutiConfigData.length > 0) {
            nextUrutan = Math.max(...window.formCutiConfigData.map(d => d.urutan || 0)) + 1;
        }
        payload.urutan = nextUrutan;
        res = await supabaseClient.from('form_cuti_config').insert([payload]);
    }

    if (res.error) {
        Swal.fire("Gagal", res.error.message, "error");
    } else {
        Swal.fire("Sukses", "Field berhasil disimpan", "success");
        if(formCutiModalInstance) formCutiModalInstance.hide();
        loadDataFormCuti();
    }
}

async function hapusFieldCuti(id) {
    const result = await Swal.fire({
        title: "Konfirmasi Hapus",
        text: "Hapus field ini dari form cuti?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;
    
    await supabaseClient.from('form_cuti_config').delete().eq('id', id);
    Swal.fire("Terhapus", "Field berhasil dihapus.", "success");
    loadDataFormCuti();
}

// =====================================
// 7. MASTER JENIS CUTI
// =====================================
let modalMasterCutiInstance = null;

async function loadMasterCuti() {
    const tbody = document.querySelector("#table-master-cuti tbody");
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from('master_jenis_cuti').select('*').order('created_at', { ascending: true });
    
    if (error || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Belum ada master cuti.</td></tr>';
        return;
    }

    window.masterCutiData = data;
    tbody.innerHTML = '';
    data.forEach(m => {
        const batasHari = m.is_unlimited ? '<span class="badge bg-success">Tanpa Batas</span>' : `${m.batas_hari} Hari`;
        tbody.innerHTML += `
            <tr>
                <td class="fw-bold">${m.nama_cuti}</td>
                <td>${batasHari}</td>
                <td>${m.siklus}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editMasterCuti('${m.id}')">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="hapusMasterCuti('${m.id}')">Hapus</button>
                </td>
            </tr>
        `;
    });
}

function showModalMasterCuti(id = '') {
    const el = document.getElementById('modalMasterCuti');
    if(!modalMasterCutiInstance) modalMasterCutiInstance = new bootstrap.Modal(el);
    
    document.getElementById('modalMasterCutiLabel').innerText = id ? 'Edit Jenis Cuti' : 'Tambah Jenis Cuti';
    document.getElementById('master-id').value = id;
    
    if(!id) {
        document.getElementById('master-nama').value = '';
        document.getElementById('master-unlimited').checked = false;
        document.getElementById('master-batas').value = '';
        document.getElementById('master-siklus').value = 'Tahunan';
        toggleMasterBatas();
    }
    
    modalMasterCutiInstance.show();
}

function toggleMasterBatas() {
    const isUnlimited = document.getElementById('master-unlimited').checked;
    const batasEl = document.getElementById('master-batas');
    if(isUnlimited) {
        batasEl.value = '0';
        batasEl.disabled = true;
    } else {
        batasEl.disabled = false;
        if(batasEl.value === '0') batasEl.value = '';
    }
}

function editMasterCuti(id) {
    if(!window.masterCutiData) return;
    const m = window.masterCutiData.find(item => item.id == id);
    if(!m) return;

    showModalMasterCuti(id);
    document.getElementById('master-nama').value = m.nama_cuti;
    document.getElementById('master-unlimited').checked = m.is_unlimited;
    document.getElementById('master-batas').value = m.batas_hari;
    document.getElementById('master-siklus').value = m.siklus;
    toggleMasterBatas();
}

async function simpanMasterCuti(event) {
    event.preventDefault();
    const id = document.getElementById('master-id').value;
    const payload = {
        nama_cuti: document.getElementById('master-nama').value,
        is_unlimited: document.getElementById('master-unlimited').checked,
        batas_hari: document.getElementById('master-unlimited').checked ? 0 : parseInt(document.getElementById('master-batas').value),
        siklus: document.getElementById('master-siklus').value
    };

let res;
    if (id) {
        res = await supabaseClient.from('master_jenis_cuti').update(payload).eq('id', id);
    } else {
        res = await supabaseClient.from('master_jenis_cuti').insert([payload]);
    }

    // TAMBAHKAN PENGECEKAN ERROR INI
    if (res.error) {
        Swal.fire("Gagal", res.error.message, "error");
        return;
    }

    modalMasterCutiInstance.hide();
    Swal.fire("Berhasil", "Master Cuti berhasil disimpan!", "success");
    loadMasterCuti();
}

async function hapusMasterCuti(id) {
    const result = await Swal.fire({
        title: "Konfirmasi Hapus",
        text: "Yakin ingin menghapus master cuti ini?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;
    
    await supabaseClient.from('master_jenis_cuti').delete().eq('id', id);
    Swal.fire("Terhapus", "Data berhasil dihapus.", "success");
    loadMasterCuti();
}

// =====================================
// EXPORT DATA
// =====================================
async function prosesExport(event) {
    event.preventDefault();
    const btn = document.getElementById("btn-export");
    const tglMulai = document.getElementById("export_mulai").value;
    const tglSelesai = document.getElementById("export_selesai").value;
    const isMedia = document.getElementById("export_media").checked;

    btn.disabled = true;
    btn.innerHTML = "Memproses... Mohon tunggu";

    try {
        let query = supabaseClient.from('absensi').select('*, users!inner(nama, cabang)')
            .gte('tanggal', tglMulai)
            .lte('tanggal', tglSelesai)
            .not('status', 'ilike', '%-TRASH-%')
            .order('tanggal', {ascending: true});
            
        // Jika bukan super admin, filter cabang
        if (!isSuperAdmin) {
            query = query.eq('users.cabang', myCabang);
        }

        const { data, error } = await query;
        if (error) throw error;
        
        // Buat ZIP
        const zip = new JSZip();
        // Format root folder: keterangan tanggal contoh 04-07-2026
        const folderName = `${tglMulai.split('-').reverse().join('-')}_sd_${tglSelesai.split('-').reverse().join('-')}`;
        const rootFolder = zip.folder(folderName);
        
        // 1. Buat CSV
        let csvContent = "Tanggal,Nama,Cabang,Waktu Masuk,Waktu Istirahat Keluar,Waktu Istirahat Masuk,Waktu Pulang,Status Kehadiran,Jarak (Meter)\n";
        
        // 2. Siapkan Folder Media jika dicentang
        let mediaFolder;
        if (isMedia) {
            mediaFolder = rootFolder.folder("media");
        }

        // Gunakan for...of karena kita butuh await di dalam loop untuk fetch gambar
        for (const row of data) {
            const namaUser = row.users ? row.users.nama : 'Unknown';
            const cabangUser = row.users ? row.users.cabang : '-';
            
            // Tambahkan baris ke CSV
            const safeName = `"${namaUser}"`;
            const safeCabang = `"${cabangUser}"`;
            csvContent += `${row.tanggal},${safeName},${safeCabang},${row.waktu_masuk || '-'},${row.waktu_istirahat_keluar || '-'},${row.waktu_istirahat_masuk || '-'},${row.waktu_keluar || '-'},${row.status || '-'},${row.jarak_meter || 0}\n`;

            // Proses Foto jika diceklis
            if (isMedia) {
                const userFolder = mediaFolder.folder(namaUser);
                const tgl = row.tanggal;
                
                const simpanFoto = async (url, namaFile) => {
                    if (url && url.startsWith('http')) {
                        try {
                            const response = await fetch(url);
                            const blob = await response.blob();
                            userFolder.file(namaFile, blob);
                        } catch (err) {
                            console.error("Gagal mendownload foto:", url, err);
                        }
                    }
                };

                await simpanFoto(row.foto_masuk, `${tgl}_Masuk.png`);
                await simpanFoto(row.foto_istirahat_keluar, `${tgl}_IstirahatKeluar.png`);
                await simpanFoto(row.foto_istirahat_masuk, `${tgl}_IstirahatMasuk.png`);
                await simpanFoto(row.foto_keluar, `${tgl}_Keluar.png`);
            }
        }

        // Simpan CSV ke root folder zip
        rootFolder.file("rekap_absen.csv", csvContent);

        // 3. AMBIL DATA CUTI / IZIN
        let queryCuti = supabaseClient.from('cuti').select('*, users!inner(nama, cabang)')
            .lte('tanggal_mulai', tglSelesai)
            .gte('tanggal_selesai', tglMulai)
            .order('tanggal_mulai', {ascending: false});
            
        if (!isSuperAdmin) {
            queryCuti = queryCuti.eq('users.cabang', myCabang);
        }

        const { data: dataCuti, error: errCuti } = await queryCuti;
        if (!errCuti && dataCuti && dataCuti.length > 0) {
            let csvCuti = "Nama,Cabang,Tanggal Mulai,Tanggal Selesai,Durasi (Hari),Status Pengajuan,Detail Tambahan\n";
            dataCuti.forEach(cuti => {
                const namaUser = cuti.users ? cuti.users.nama : 'Unknown';
                const cabangUser = cuti.users ? cuti.users.cabang : '-';
                
                let tambahan = "";
                if (cuti.data_tambahan) {
                    const values = Object.values(cuti.data_tambahan).map(v => typeof v === 'string' ? v.replace(/,/g, ';') : v);
                    tambahan = values.join(" | ");
                } else if (cuti.alasan) {
                    tambahan = cuti.alasan.replace(/,/g, ';');
                }

                const safeName = `"${namaUser}"`;
                const safeCabang = `"${cabangUser}"`;
                const safeTambahan = `"${tambahan}"`;
                
                csvCuti += `${safeName},${safeCabang},${cuti.tanggal_mulai},${cuti.tanggal_selesai},${cuti.durasi_hari},${cuti.status_pengajuan},${safeTambahan}\n`;
            });
            rootFolder.file("rekap_izin_cuti.csv", csvCuti);
        }

        // Generate dan download zip
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, `Export_${folderName}.zip`);

        Swal.fire("Sukses", "Data berhasil diexport!", "success");
    } catch (err) {
        Swal.fire("Gagal", err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "📥 Export to ZIP";
    }
}

// =====================================
// DANGER ZONE (TRASH & CLEANUP)
// =====================================
async function loadTrash() {
    const tbody = document.querySelector("#table-trash tbody");
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Memuat data sampah...</td></tr>';
    
    let queryTrash = supabaseClient.from('absensi').select('*, users!inner(nama, cabang)')
        .ilike('status', '%-TRASH-%')
        .order('tanggal', { ascending: false });
    
    if (!isSuperAdmin) {
        queryTrash = queryTrash.eq('users.cabang', myCabang);
    }

    const { data, error } = await queryTrash;
    if (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-danger">Gagal memuat: ' + error.message + '</td></tr>';
        return;
    }

    // Auto cleanup logic: Hapus permanen jika sudah > 3 hari
    const tigaHariLalu = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const dataAman = [];
    const dataHapus = [];

    data.forEach(row => {
        const parts = row.status.split('-TRASH-');
        const ts = parseInt(parts[1]);
        if (ts < tigaHariLalu) {
            dataHapus.push(row);
        } else {
            dataAman.push({ ...row, ts_dibuang: ts, status_asli: parts[0] });
        }
    });

    // Jika ada yang expired, hapus background
    if (dataHapus.length > 0) {
        // Run async without blocking UI
        setTimeout(() => {
            dataHapus.forEach(r => hapusPermanenInternal(r));
        }, 1000);
    }

    if (dataAman.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Tempat sampah kosong.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    dataAman.forEach(row => {
        const dateStr = new Date(row.ts_dibuang).toLocaleString();
        tbody.innerHTML += `
            <tr>
                <td>${row.users?.nama || 'Unknown'}</td>
                <td>${row.tanggal}</td>
                <td><span class="badge bg-secondary">${row.status_asli}</span></td>
                <td>${dateStr}</td>
                <td>
                    <button class="btn btn-sm btn-success mb-1 w-100" onclick="pulihkanData('${row.id}', '${row.status_asli}')">🔄 Pulihkan</button>
                    <button class="btn btn-sm btn-danger w-100" onclick="hapusPermanenSatu('${row.id}')">🗑️ Hapus Permanen</button>
                </td>
            </tr>
        `;
    });
}

async function prosesPindahKeSampah(event) {
    event.preventDefault();
    const btn = document.getElementById("btn-trash-move");
    const tglMulai = document.getElementById("trash_mulai").value;
    const tglSelesai = document.getElementById("trash_selesai").value;

    const res = await Swal.fire({
        title: "Pindahkan ke Sampah?",
        text: `Data absen dari ${tglMulai} s/d ${tglSelesai} akan dibuang ke tong sampah dan bisa dihapus otomatis.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Ya, pindahkan!"
    });
    
    if (!res.isConfirmed) return;

    btn.disabled = true;
    btn.innerHTML = "Memproses...";

    try {
        let query = supabaseClient.from('absensi').select('id, status, users!inner(cabang)')
            .gte('tanggal', tglMulai)
            .lte('tanggal', tglSelesai)
            .not('status', 'ilike', '%-TRASH-%');
        if (!isSuperAdmin) query = query.eq('users.cabang', myCabang);

        const { data, error } = await query;
        if (error) throw error;
        if (data.length === 0) throw new Error("Tidak ada data ditemukan untuk diremove.");

        const ts = Date.now();
        // Update per row (Supabase free tier max bulk limits might apply, but let's do parallel)
        const updatePromises = data.map(row => 
            supabaseClient.from('absensi').update({ status: `${row.status}-TRASH-${ts}` }).eq('id', row.id)
        );
        await Promise.all(updatePromises);
        
        Swal.fire("Berhasil", `${data.length} data dipindahkan ke tempat sampah.`, "success");
        loadTrash();
        loadDataAbsensi();
    } catch (err) {
        Swal.fire("Gagal", err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "🗑️ Pindahkan ke Sampah";
    }
}

async function pulihkanData(id, statusAsli) {
    try {
        await supabaseClient.from('absensi').update({ status: statusAsli }).eq('id', id);
        Swal.fire("Berhasil", "Data berhasil dipulihkan.", "success");
        loadTrash();
        loadDataAbsensi();
    } catch (err) {
        Swal.fire("Gagal", err.message, "error");
    }
}

async function hapusPermanenSatu(id) {
    const res = await Swal.fire({
        title: "Hapus Permanen?",
        text: "Data beserta foto-fotonya akan hilang selamanya!",
        icon: "error",
        showCancelButton: true,
        confirmButtonText: "Hapus Permanen"
    });
    if (!res.isConfirmed) return;

    try {
        const { data: row } = await supabaseClient.from('absensi').select('*').eq('id', id).single();
        if (row) await hapusPermanenInternal(row);
        Swal.fire("Dihapus", "Data terhapus permanen.", "success");
        loadTrash();
    } catch (err) {
        Swal.fire("Gagal", err.message, "error");
    }
}

async function kosongkanSampah() {
    const res = await Swal.fire({
        title: "Kosongkan Tempat Sampah?",
        text: "Seluruh data sampah (termasuk foto) akan dihapus permanen saat ini juga!",
        icon: "error",
        showCancelButton: true,
        confirmButtonText: "Kosongkan"
    });
    if (!res.isConfirmed) return;

    try {
        let queryTrash = supabaseClient.from('absensi').select('*, users!inner(cabang)').ilike('status', '%-TRASH-%');
        if (!isSuperAdmin) queryTrash = queryTrash.eq('users.cabang', myCabang);
        
        const { data } = await queryTrash;
        if (data && data.length > 0) {
            Swal.fire("Proses", "Sedang menghapus data, jangan tutup jendela...", "info");
            for (let r of data) {
                await hapusPermanenInternal(r);
            }
            Swal.fire("Berhasil", "Semua data di tempat sampah telah dihapus.", "success");
            loadTrash();
        } else {
            Swal.fire("Info", "Tempat sampah sudah kosong.", "info");
        }
    } catch (err) {
        Swal.fire("Gagal", err.message, "error");
    }
}

async function hapusPermanenInternal(row) {
    try {
        // Hapus file storage
        const files = [];
        const extractFilename = (url) => url ? url.split('/').pop() : null;
        if (row.foto_masuk) files.push(extractFilename(row.foto_masuk));
        if (row.foto_istirahat_keluar) files.push(extractFilename(row.foto_istirahat_keluar));
        if (row.foto_istirahat_masuk) files.push(extractFilename(row.foto_istirahat_masuk));
        if (row.foto_keluar) files.push(extractFilename(row.foto_keluar));
        
        const validFiles = files.filter(f => f);
        if (validFiles.length > 0) {
            await supabaseClient.storage.from('absensi-bucket').remove(validFiles);
        }
        
        // Hapus row DB
        await supabaseClient.from('absensi').delete().eq('id', row.id);
    } catch (err) {
        console.error("Gagal menghapus internal:", row.id, err);
    }
}

// =====================================
// 10. PENGATURAN APLIKASI
// =====================================
async function loadSettings() {
    try {
        const { data, error } = await supabaseClient.from('app_settings').select('*').eq('id', 1).single();
        if (error && error.code !== 'PGRST116') {
            console.error('Error load settings:', error);
            return;
        }
        
        if (data) {
            document.getElementById('setting_nama_aplikasi').value = data.nama_aplikasi || '';
            document.getElementById('setting_login_subteks').value = data.login_subteks || '';
            document.getElementById('setting_form_judul').value = data.form_judul || '';
            document.getElementById('setting_pengumuman').value = data.pengumuman || '';
            document.getElementById('setting_pengumuman_warna').value = data.pengumuman_warna || 'alert-info';
            document.getElementById('setting_enable_lokasi').checked = data.enable_lokasi !== false;
            document.getElementById('setting_enable_kamera').checked = data.enable_kamera !== false;
            
            if (data.logo_url) {
                currentLogoUrl = data.logo_url;
                const imgPreview = document.getElementById('preview_setting_logo');
                if (imgPreview) {
                    imgPreview.src = data.logo_url;
                    imgPreview.style.display = 'inline-block';
                }
                
                // Set Favicon
                let link = document.querySelector("link[rel~='icon']");
                if (!link) {
                    link = document.createElement('link');
                    link.rel = 'icon';
                    document.head.appendChild(link);
                }
                link.href = data.logo_url;
            }

            if (data.nama_aplikasi) {
                const brand = document.querySelector('.navbar-brand');
                if (brand) brand.innerHTML = `Admin Panel ${data.nama_aplikasi}`;
            }
        }
    } catch (err) {
        console.error(err);
    }
}

async function saveSettings() {
    const nama_aplikasi = document.getElementById('setting_nama_aplikasi').value;
    const login_subteks = document.getElementById('setting_login_subteks').value;
    const form_judul = document.getElementById('setting_form_judul').value;
    const pengumuman = document.getElementById('setting_pengumuman').value;
    const pengumuman_warna = document.getElementById('setting_pengumuman_warna').value;
    const enable_lokasi = document.getElementById('setting_enable_lokasi').checked;
    const enable_kamera = document.getElementById('setting_enable_kamera').checked;
    const fileInput = document.getElementById('setting_logo_file');
    
    try {
        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        let logo_url = currentLogoUrl;
        
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `logo-${Date.now()}.${fileExt}`;
            
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('absensi-bucket')
                .upload(`assets/${fileName}`, file, { upsert: true });
                
            if (uploadError) throw uploadError;
            
            const { data: publicUrlData } = supabaseClient.storage
                .from('absensi-bucket')
                .getPublicUrl(`assets/${fileName}`);
                
            logo_url = publicUrlData.publicUrl;
        }

        const payload = { id: 1, nama_aplikasi, login_subteks, form_judul, logo_url, pengumuman, pengumuman_warna, enable_lokasi, enable_kamera };
        
        const { error } = await supabaseClient.from('app_settings').upsert(payload, { onConflict: 'id' });
        
        if (error) throw error;
        
        Swal.fire('Berhasil', 'Pengaturan berhasil disimpan!', 'success');
    } catch (err) {
        console.error(err);
        Swal.fire('Error', 'Gagal menyimpan pengaturan.', 'error');
    }
}

// =====================================
// 7. EXPORT & IMPORT DATABASE + KARYAWAN
// =====================================

async function downloadTemplateKaryawan() {
    // Ambil info cabang untuk instruksi
    const { data: cabangData } = await supabaseClient.from('kantor').select('nama');
    let listCabang = ['Pusat'];
    if(cabangData && cabangData.length > 0) {
        listCabang = cabangData.map(c => c.nama);
    }
    
    await Swal.fire({
        title: 'Informasi Penting CSV',
        html: `
            <div class="text-start small">
                <b>1. Role yang tersedia:</b> Karyawan / HR<br>
                <b>2. Cabang yang tersedia:</b> ${listCabang.join(", ")}<br>
                <b>3. Jadwal Libur:</b> 0=Minggu, 1=Senin, 2=Selasa, dst. (Contoh: "0,6" untuk libur Sabtu & Minggu). Wajib pakai tanda kutip di Excel jika ada koma.
            </div>
        `,
        icon: 'info',
        confirmButtonText: 'Paham, Unduh Template'
    });
    
    const headers = ["Nama Lengkap", "Role (Karyawan/HR)", "Cabang", "No HP/WA", "Password", "Jadwal Libur"];
    const contohData = ["Budi Santoso", "Karyawan", "Pusat", "08123456789", "rahasia123", "0,6"];
    
    const mapCsv = row => row.map(v => `"${v}"`).join(",");
    
    let csvContent = "";
    csvContent += mapCsv(headers) + "\n";
    csvContent += mapCsv(contohData) + "\n";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "Template_Import_Karyawan.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function exportKaryawan() {
    Swal.fire({ title: 'Menyiapkan Export...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const { data, error } = await supabaseClient.from('users').select('*');
        if (error) throw error;
        
        const headers = ["Nama Lengkap", "Role (Karyawan/HR)", "Cabang", "No HP/WA", "Jadwal Libur"];
        const mapCsv = row => row.map(v => `"${v || ''}"`).join(",");
        
        let csvContent = mapCsv(headers) + "\n";
        
        data.forEach(user => {
            const row = [user.nama, user.role, user.cabang, user.no_hp, user.hari_libur];
            csvContent += mapCsv(row) + "\n";
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Data_Karyawan_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        Swal.fire("Berhasil", "Data karyawan berhasil di-export!", "success");
    } catch(err) {
        Swal.fire("Error", "Gagal export data: " + err.message, "error");
    }
}

async function importKaryawan(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    Swal.fire({ title: 'Membaca File...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        
        if (lines.length < 2) {
            Swal.fire("Error", "File kosong atau tidak memiliki data yang valid", "error");
            event.target.value = '';
            return;
        }
        
        // Cek jika delimiter semicolon digunakan oleh Excel
        const isSemicolon = lines[0].includes(';') && !lines[0].includes(',');
        const delimiter = isSemicolon ? ';' : ',';
        const regexSplit = isSemicolon ? /;(?=(?:(?:[^"]*"){2})*[^"]*$)/ : /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
        
        const dataLines = lines.slice(1);
        let successCount = 0;
        let failCount = 0;
        let errorDetails = [];
        let index = 1;
        
        for (const line of dataLines) {
            index++;
            // Split CSV proper: match delimiters outside of quotes
            const cols = line.split(regexSplit);
            if (cols.length < 6) { 
                failCount++; 
                errorDetails.push(`Baris ${index}: Format kolom tidak lengkap`);
                continue; 
            }
            
            let [nama, role, cabang, no_hp, password, hari_libur] = cols.map(c => c.trim().replace(/^"|"$/g, ''));
            
            // Jika no_hp (opsional) kosong, biarkan kosong atau strip
            if (!no_hp || no_hp === "") {
                no_hp = "-";
            }
            
            // Periksa duplicate nama (karena login pake nama)
            const { data: existingUser } = await supabaseClient.from('users').select('id, nama').eq('nama', nama).single();
            if (existingUser) {
                failCount++;
                errorDetails.push(`Baris ${index}: Karyawan dengan nama "${nama}" sudah ada`);
                continue;
            }
            
            // Insert langsung ke tabel users (tanpa auth.signUp karena login lokal)
            const { error: insertError } = await supabaseClient.from('users').insert([{
                nama: nama || "Tanpa Nama",
                password: password || '123456',
                role: role || "Karyawan",
                cabang: cabang || "Pusat",
                no_hp: no_hp,
                hari_libur: hari_libur || "0,6",
                sisa_cuti: 12
            }]);
            
            if (insertError) {
                failCount++;
                errorDetails.push(`Baris ${index} (${nama}): ${insertError.message}`);
            } else {
                successCount++;
            }
        }
        
        event.target.value = '';
        
        let resultMsg = `Berhasil: ${successCount} karyawan. Gagal: ${failCount} karyawan.`;
        if (errorDetails.length > 0) {
            resultMsg += `<br><br><div class="text-start small p-2 bg-light border" style="max-height:150px; overflow-y:auto; font-size:12px;">${errorDetails.join("<br>")}</div>`;
        }
        
        Swal.fire({
            title: "Proses Import Selesai",
            html: resultMsg,
            icon: failCount > 0 ? "warning" : "success"
        });
        
        await loadDataKaryawan();
        await loadDashboardStats();
    };
    reader.readAsText(file);
}

async function backupDatabase() {
    const includeMedia = document.getElementById('backup_media')?.checked;
    
    Swal.fire({ title: includeMedia ? 'Membackup Database & Media...' : 'Membackup Database...', html: 'Proses ini mungkin memakan waktu agak lama.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const dbBackup = {};
        const tables = ['users', 'cabang', 'absensi', 'cuti', 'form_cuti_config', 'app_settings'];
        
        for (const table of tables) {
            try {
                const { data, error } = await supabaseClient.from(table).select('*');
                if (error) console.warn(`Supabase error for table ${table}:`, error);
                dbBackup[table] = data || [];
            } catch (e) {
                console.warn(`Failed to fetch table ${table}`, e);
                dbBackup[table] = [];
            }
        }
        
        const json = JSON.stringify(dbBackup, null, 2);
        const d = new Date();
        const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        
        if (includeMedia) {
            const zip = new JSZip();
            zip.file("database_backup.json", json);
            const mediaFolder = zip.folder("media");
            
            const mediaTasks = [];

            // Collect media from absensi
            for (const a of dbBackup['absensi'] || []) {
                const userName = dbBackup['users']?.find(u => u.id === a.user_id)?.nama || 'Unknown';
                const fName = `${userName}_${a.tanggal}`.replace(/[^a-z0-9]/gi, '_');
                
                const addMediaTask = (url, suffix) => {
                    if (!url) return;
                    mediaTasks.push(async () => {
                        try {
                            const res = await fetch(url);
                            if(res.ok) {
                                const blob = await res.blob();
                                const ext = url.split('?')[0].split('.').pop() || 'jpg';
                                mediaFolder.file(`absensi/${fName}_${suffix}.${ext}`, blob);
                            }
                        } catch(e) {}
                    });
                };
                
                addMediaTask(a.foto_masuk, "Masuk");
                addMediaTask(a.foto_pulang, "Pulang");
                addMediaTask(a.foto_istirahat_keluar, "istKeluar");
                addMediaTask(a.foto_istirahat_masuk, "ist_mask");
            }
            
            // Collect media from cuti
            for (const c of dbBackup['cuti'] || []) {
                if (c.data_tambahan) {
                    const userName = dbBackup['users']?.find(u => u.id === c.user_id)?.nama || 'Unknown';
                    const fName = `${userName}_${c.tanggal_mulai}`.replace(/[^a-z0-9]/gi, '_');
                    
                    for (const [key, url] of Object.entries(c.data_tambahan)) {
                        if (typeof url === 'string' && url.startsWith('http')) {
                            mediaTasks.push(async () => {
                                try {
                                    const res = await fetch(url);
                                    if(res.ok) {
                                        const blob = await res.blob();
                                        const ext = url.split('?')[0].split('.').pop() || 'jpg';
                                        mediaFolder.file(`cuti/${fName}_${key.replace(/[^a-z0-9]/gi,'_')}.${ext}`, blob);
                                    }
                                } catch(e) {}
                            });
                        }
                    }
                }
            }
            
            // Execute fetching in batches to avoid hanging the browser
            let completed = 0;
            const batchSize = 10;
            for (let i = 0; i < mediaTasks.length; i += batchSize) {
                const batch = mediaTasks.slice(i, i + batchSize);
                await Promise.all(batch.map(task => task()));
                completed += batch.length;
                Swal.update({ html: `Mendownload media... (${Math.min(completed, mediaTasks.length)} / ${mediaTasks.length})` });
            }
            
            Swal.update({ html: `Membuat file ZIP, mohon tunggu...` });
            const zipContent = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipContent);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Backup_Full_Absensi_${dateStr}.zip`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } else {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Backup_DB_Absensi_${dateStr}.json`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        Swal.fire("Berhasil", "Backup berhasil diunduh!", "success");
    } catch(err) {
        Swal.fire("Error", "Gagal membackup: " + err.message, "error");
    }
}

async function restoreDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const result = await Swal.fire({
        title: "Peringatan Berbahaya!",
        text: "Restore akan MENIMPA dan MENGHAPUS seluruh data Anda saat ini. Lanjutkan?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Ya, Timpa Semua Data!"
    });
    
    if (!result.isConfirmed) {
        event.target.value = '';
        return;
    }
    
    Swal.fire({ title: 'Memulihkan Database...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            // Reverse order to handle foreign keys
            const tables = ['absensi', 'cuti', 'form_cuti_config', 'cabang']; 
            
            for (const table of tables) {
                if (data[table] && data[table].length > 0) {
                    // Karena Supabase API tidak memperbolehkan truncate langsung tanpa RLS/RPC khusus dari Client,
                    // Kita akan mencoba upsert.
                    await supabaseClient.from(table).upsert(data[table]);
                }
            }
            // Khusus Users dan AppSettings
            if (data['users'] && data['users'].length > 0) {
                await supabaseClient.from('users').upsert(data['users']);
            }
            if (data['app_settings'] && data['app_settings'].length > 0) {
                await supabaseClient.from('app_settings').upsert(data['app_settings']);
            }
            
            Swal.fire("Berhasil", "Data berhasil dipulihkan! Halaman akan dimuat ulang.", "success").then(() => {
                location.reload();
            });
        } catch(err) {
            Swal.fire("Error", "Format JSON tidak valid atau gagal restore: " + err.message, "error");
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

async function resetWajahKaryawan() {
    const id = document.getElementById("karyawan_id").value;
    if (!id) return;
    
    const result = await Swal.fire({
        title: "Konfirmasi Reset Wajah",
        text: "Wajah karyawan ini akan dihapus dan mereka wajib mendaftar ulang saat login. Lanjutkan?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Reset Wajah!"
    });

    if (!result.isConfirmed) return;

    const { error } = await supabaseClient.from('users').update({ 
        face_descriptor: null, 
        foto_wajah: null 
    }).eq('id', id);

    if (error) {
        Swal.fire("Gagal", error.message, "error");
        return;
    }
    
    Swal.fire("Berhasil", "Data wajah karyawan telah dihapus.", "success");
    document.getElementById("foto-wajah-container").innerHTML = `<span class="text-muted small">Belum terdaftar</span>`;
    document.getElementById("btn-reset-wajah").classList.add('d-none');
    loadDataKaryawan();
}

async function hapusDataAbsen(absenId, tanggal) {
    const result = await Swal.fire({
        title: "Hapus Data Absen?",
        text: "Seluruh foto dan rekaman absensi akan dihapus permanen. Karyawan akan dianggap belum absen.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Ya, Hapus!"
    });

    if (!result.isConfirmed) return;
    
    // Ambil data absen
    const { data: absenData } = await supabaseClient.from('absensi').select('*').eq('id', absenId).maybeSingle();
    if (absenData) {
        const fotoFiles = [
            absenData.foto_masuk,
            absenData.foto_istirahat_keluar,
            absenData.foto_istirahat_masuk,
            absenData.foto_keluar
        ];
        
        const filesToDelete = fotoFiles.filter(f => f).map(url => {
            const parts = url.split('/');
            return parts[parts.length - 1];
        });
        
        if (filesToDelete.length > 0) {
            await supabaseClient.storage.from('absensi-bucket').remove(filesToDelete);
        }
    }

    const { error } = await supabaseClient.from('absensi').delete().eq('id', absenId);
    if (error) {
        Swal.fire("Gagal", error.message, "error");
        return;
    }
    
    Swal.fire("Berhasil", "Data absen beserta foto berhasil dihapus.", "success");
    bootstrap.Modal.getInstance(document.getElementById('modalDetailAbsensi')).hide();
    loadDataAbsensi();
}

// ==========================================
// FACTORY RESET
// ==========================================
async function factoryResetDatabase() {
    if (!isSuperAdmin) {
        Swal.fire("Akses Ditolak", "Hanya Super Admin yang dapat melakukan Factory Reset.", "error");
        return;
    }

    const { value: confirmText } = await Swal.fire({
        title: "Konfirmasi Factory Reset!",
        text: "Ketik 'RESET' (huruf besar) untuk melanjutkan. SEMUA DATA AKAN HILANG PERMANEN!",
        icon: "warning",
        input: 'text',
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Eksekusi Reset!"
    });

    if (confirmText !== 'RESET') {
        if (confirmText) Swal.fire("Dibatalkan", "Teks konfirmasi salah.", "info");
        return;
    }

    Swal.fire({ 
        title: 'Memproses Factory Reset...', 
        html: 'Menghapus seluruh data absensi, cuti, cabang dan karyawan...<br><small>Proses ini mungkin memakan waktu agak lama.</small>', 
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });

    try {
        // Hapus isi tabel
        const tablesToClear = ['absensi', 'cuti', 'form_cuti_config', 'cabang'];
        
        for (const table of tablesToClear) {
            try {
                const { data } = await supabaseClient.from(table).select('*');
                if (data && data.length > 0) {
                    let deleteCol = data[0].id !== undefined ? 'id' : (data[0].nama !== undefined ? 'nama' : Object.keys(data[0])[0]);
                    await supabaseClient.from(table).delete().not(deleteCol, 'is', null);
                }
            } catch(e) {
                console.warn("Gagal mereset tabel", table, e);
            }
        }

        // Hapus semua users KECUALI super admin yang sedang login
        try {
            await supabaseClient.from('users').delete().neq('id', currentUser.id);
        } catch(e) {
            console.warn("Gagal mereset users", e);
        }

        Swal.fire("Berhasil", "Sistem telah direset ke pengaturan awal pabrik.", "success").then(() => {
            window.location.reload();
        });
    } catch (err) {
        Swal.fire("Gagal Reset", err.message, "error");
    }
}

let currentLogoUrl = '';

function previewSettingLogo(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('preview_setting_logo').src = e.target.result;
            document.getElementById('preview_setting_logo').style.display = 'inline-block';
        }
        reader.readAsDataURL(file);
    }
}

async function moveUrutanCuti(id, direction) {
    if (!window.formCutiConfigData) return;
    const data = window.formCutiConfigData;
    const currentIndex = data.findIndex(item => item.id == id);
    if (currentIndex === -1) return;
    
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= data.length) return;
    
    const currentItem = data[currentIndex];
    const targetItem = data[targetIndex];
    
    // Tukar urutan
    const tempUrutan = currentItem.urutan;
    currentItem.urutan = targetItem.urutan;
    targetItem.urutan = tempUrutan;
    
    try {
        Swal.fire({ title: 'Memperbarui urutan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        await supabaseClient.from('form_cuti_config').update({ urutan: currentItem.urutan }).eq('id', currentItem.id);
        await supabaseClient.from('form_cuti_config').update({ urutan: targetItem.urutan }).eq('id', targetItem.id);
        
        Swal.close();
        loadDataFormCuti();
    } catch(err) {
        console.error(err);
        Swal.fire('Error', 'Gagal memperbarui urutan', 'error');
    }
}

// Global fix for Bootstrap 5 aria-hidden focus warnings on all modals
document.addEventListener('hide.bs.modal', function () {
    if (document.activeElement) {
        document.activeElement.blur();
    }
});

function lihatFotoAbsenSingle(url) {
    tampilkanPopupFoto(url, 'Absen');
}

async function loadTipeAbsenAdmin() {
    const tbody = document.getElementById("tabel-tipe-absen");
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from("master_tipe_absen").select("*").order("id", { ascending: true });
    if (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger">Error: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Belum ada tipe absen.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td class="fw-bold">${item.nama_tipe}</td>
            <td><small>${item.jam_mulai || '-'} s/d ${item.batas_terlambat || '-'}</small></td>
            <td>${item.is_checkout ? '<span class="badge bg-success">Ya</span>' : '<span class="badge bg-secondary">Tidak</span>'}</td>
            <td>
                <div class="form-check form-switch d-flex justify-content-center">
                    <input class="form-check-input" type="checkbox" ${item.is_aktif ? 'checked' : ''} onchange="toggleStatusTipeAbsen(${item.id}, this.checked)">
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-warning shadow-sm me-1" onclick="editTipeAbsen(${item.id}, '${item.nama_tipe}', '${item.jam_mulai || ''}', '${item.batas_terlambat || ''}', ${item.is_checkout})"><i class="fas fa-edit me-1"></i>Edit</button>
                <button class="btn btn-sm btn-danger shadow-sm" onclick="hapusTipeAbsen(${item.id})"><i class="fas fa-trash-alt me-1"></i>Hapus</button>
            </td>
        </tr>
    `).join('');
}

function batalEditTipeAbsen() {
    document.getElementById("tipe-absen-id").value = "";
    document.getElementById("tipe-absen-nama").value = "";
    document.getElementById("tipe-absen-mulai").value = "07:00";
    document.getElementById("tipe-absen-batas").value = "08:00";
    document.getElementById("tipe-absen-checkout").checked = false;
    const label = document.getElementById("modalTipeAbsenLabel");
    if(label) label.innerText = "Tambah Tipe Absen";
}

function editTipeAbsen(id, nama, mulai, batas, isCheckout) {
    document.getElementById("tipe-absen-id").value = id;
    document.getElementById("tipe-absen-nama").value = nama;
    document.getElementById("tipe-absen-mulai").value = mulai || '';
    document.getElementById("tipe-absen-batas").value = batas || '';
    document.getElementById("tipe-absen-checkout").checked = isCheckout === true || isCheckout === 'true';
    const label = document.getElementById("modalTipeAbsenLabel");
    if(label) label.innerText = "Edit Tipe Absen";
    new bootstrap.Modal(document.getElementById('modalTambahTipeAbsen')).show();
}

async function simpanTipeAbsen() {
    const id = document.getElementById("tipe-absen-id").value;
    const nama = document.getElementById("tipe-absen-nama").value.trim();
    const mulai = document.getElementById("tipe-absen-mulai").value;
    const batas = document.getElementById("tipe-absen-batas").value;
    const isCheckout = document.getElementById("tipe-absen-checkout").checked;

    if (!nama) {
        Swal.fire("Peringatan", "Nama tipe absen harus diisi", "warning");
        return;
    }
    
    let error;
    if (id) {
        const res = await supabaseClient.from("master_tipe_absen").update({ 
            nama_tipe: nama,
            jam_mulai: mulai,
            batas_terlambat: batas,
            is_checkout: isCheckout
        }).eq("id", id);
        error = res.error;
    } else {
        const res = await supabaseClient.from("master_tipe_absen").insert([{ 
            nama_tipe: nama,
            jam_mulai: mulai,
            batas_terlambat: batas,
            is_checkout: isCheckout
        }]);
        error = res.error;
    }
    
    if (error) {
        Swal.fire("Gagal", error.message, "error");
    } else {
        batalEditTipeAbsen();
        bootstrap.Modal.getInstance(document.getElementById("modalTambahTipeAbsen")).hide();
        loadTipeAbsenAdmin();
        Swal.fire("Berhasil", id ? "Tipe absen diperbarui" : "Tipe absen ditambahkan", "success");
    }
}

async function toggleStatusTipeAbsen(id, isAktif) {
    await supabaseClient.from("master_tipe_absen").update({ is_aktif: isAktif }).eq("id", id);
}

async function hapusTipeAbsen(id) {
    const confirm = await Swal.fire({
        title: "Hapus Tipe Absen?",
        text: "Data yang dihapus tidak bisa dikembalikan.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Ya, Hapus!"
    });
    
    if (confirm.isConfirmed) {
        const { error } = await supabaseClient.from("master_tipe_absen").delete().eq("id", id);
        if (error) {
            Swal.fire("Gagal", error.message, "error");
        } else {
            loadTipeAbsenAdmin();
            Swal.fire("Berhasil", "Dihapus", "success");
        }
    }
}

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
        let session = null;
        try {
            const { data } = await supabaseClient.auth.getSession();
            session = data?.session;
        } catch (e) {}

        // Auto-heal sesi auth jika token kadaluarsa / belum dibuat
        if (!session && currentUser && currentUser.nama && currentUser.password) {
            session = await ensureAuthenticatedSession();
        }

        let profile = null;
        const isValidUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

        if (session && session.user && isValidUUID(session.user.id)) {
            const { data: p } = await supabaseClient
                .from('users')
                .select('id, role, cabang, auth_id')
                .eq('auth_id', session.user.id)
                .maybeSingle();
            profile = p;
        }

        if (!profile && currentUser.id) {
            // Self-repair fallback: perbaiki auth_id/ambil profil dari ID user
            const { data: fallbackUser } = await supabaseClient
                .from('users')
                .select('id, role, cabang, auth_id')
                .eq('id', currentUser.id)
                .maybeSingle();

            if (fallbackUser) {
                profile = fallbackUser;
                if (session && session.user && isValidUUID(session.user.id)) {
                    await supabaseClient.from('users').update({ auth_id: session.user.id }).eq('id', fallbackUser.id);
                }
            }
        }
        
        if (!profile && currentUser.role === 'Super Admin') {
            profile = currentUser;
        }

        if (!profile) throw new Error("Profil tidak valid");
        
        // Jika ternyata dia bukan Admin/HR, tendang keluar ke halaman absen
        if (profile.role !== 'Super Admin' && profile.role !== 'HR') {
            window.location.href = "index.html";
            return;
        }

        // Sinkronisasi hak akses jika berubah
        if (profile.role !== currentUser.role || profile.cabang !== currentUser.cabang) {
            currentUser.role = profile.role;
            currentUser.cabang = profile.cabang;
            isSuperAdmin = profile.role === 'Super Admin';
            myCabang = profile.cabang || '';
            localStorage.setItem('userLogin', JSON.stringify({...currentUser, ...profile}));
            window.location.reload();
            return;
        }
    } catch (e) {
        console.warn("Session verify warning:", e);
    }

// Global logout function
window.logout = async function() {
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient.auth) {
            await supabaseClient.auth.signOut();
        }
    } catch (err) {
        console.warn("SignOut error:", err);
    }
    localStorage.removeItem('userLogin');
    window.location.href = "login.html";
};

    // Load Global App Settings (Format Waktu, Brand, dll)
    await loadSettings();
    initRealtimeAutoSync();

    // Handle Tab Routing
    let hash = window.location.hash || '#tab-dashboard';
    const targetTab = document.querySelector(`[data-bs-target="${hash}"]`);
    if (targetTab) {
        new bootstrap.Tab(targetTab).show();
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

    // Auto-Sync Polling Latar Belakang (15s) - Mencegah koneksi WebSocket wss:// di ngrok
    if (typeof window !== "undefined") {
        setInterval(() => {
            loadDashboardStats();
        }, 15000);
    }
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
    
    const groupedHadir = {};
    (absenData || []).forEach(a => {
        if (a.status === 'Alpha' || a.status === 'Cuti') return;
        
        if (!groupedHadir[a.user_id]) {
            groupedHadir[a.user_id] = {
                user_id: a.user_id,
                users: a.users,
                waktu_masuk: a.waktu, // Set default to their first record
                tipe_absen: a.tipe_absen,
                terlambat: false,
                menit_terlambat: 0,
                menit_lembur: 0,
                keterangan_waktu: ''
            };
        }
        
        if (a.tipe_absen === 'Masuk' || (a.tipe_absen && a.tipe_absen.toLowerCase().includes('masuk'))) {
            groupedHadir[a.user_id].waktu_masuk = a.waktu;
            groupedHadir[a.user_id].tipe_absen = a.tipe_absen;
        }
        
        const isTerlambatRecord = a.status === 'Terlambat' || (a.keterangan_waktu && a.keterangan_waktu.toLowerCase().startsWith('terlambat'));
        let mTelat = parseInt(a.menit_terlambat, 10) || 0;
        if (!mTelat && isTerlambatRecord && a.keterangan_waktu) {
            const matchJ = a.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
            const matchM = a.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
            if (matchJ || matchM) {
                const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                const m = matchM ? parseInt(matchM[1], 10) : 0;
                mTelat = j * 60 + m;
            } else {
                const matchRaw = a.keterangan_waktu.match(/Terlambat\s+(\d+)/i);
                if (matchRaw) mTelat = parseInt(matchRaw[1], 10);
            }
        }

        if (isTerlambatRecord || mTelat > 0) {
            groupedHadir[a.user_id].terlambat = true;
            if (mTelat > 0) {
                groupedHadir[a.user_id].menit_terlambat = Math.max(groupedHadir[a.user_id].menit_terlambat || 0, mTelat);
            }
        }

        const isLemburRecord = a.status === 'Lembur' || (a.keterangan_waktu && a.keterangan_waktu.toLowerCase().startsWith('lembur'));
        let mLembur = parseInt(a.menit_lembur, 10) || 0;
        if (!mLembur && isLemburRecord && a.keterangan_waktu) {
            const matchJ = a.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
            const matchM = a.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
            if (matchJ || matchM) {
                const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                const m = matchM ? parseInt(matchM[1], 10) : 0;
                mLembur = j * 60 + m;
            }
        }
        if (mLembur > 0) {
            groupedHadir[a.user_id].menit_lembur = Math.max(groupedHadir[a.user_id].menit_lembur || 0, mLembur);
        }

        if (a.keterangan_waktu) {
            groupedHadir[a.user_id].keterangan_waktu = a.keterangan_waktu;
        }
    });
    
    dbHadirList = Object.values(groupedHadir);
    dbTerlambatList = dbHadirList.filter(item => item.terlambat);
    
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
    if (pengumumanContainer) {
        try {
            const { data: settingData } = await supabaseClient.from('app_settings').select('pengumuman, pengumuman_warna').eq('id', 1).maybeSingle();
            if (settingData && settingData.pengumuman) {
                const htmlContent = window.marked ? marked.parse(settingData.pengumuman) : settingData.pengumuman;
                const colorClass = settingData.pengumuman_warna || 'alert-info';
                pengumumanContainer.innerHTML = `<div class="alert ${colorClass} shadow-sm">${htmlContent}</div>`;
            } else {
                pengumumanContainer.innerHTML = '<div class="text-muted text-center"><small>Belum ada pengumuman.</small></div>';
            }
        } catch(err) {
            console.warn("Gagal memuat pengumuman dashboard:", err);
        }
    }

    // 5. Render Chart 7 Hari
    renderAttendanceChart();
}

function showDashboardDetail(type) {
    const titleEl = document.getElementById('modalDetailDashboardTitle');
    const headerEl = document.getElementById('modalDetailDashboardHeader');
    const thead = document.getElementById('modalDetailDashboardHead');
    const tbody = document.getElementById('modalDetailDashboardBody');
    
    let dataList = [];
    
    headerEl.className = 'modal-header text-white'; // Reset class
    
    if (type === 'hadir') {
        titleEl.innerHTML = '<i class="fas fa-check-circle"></i> Karyawan Sudah Absen';
        headerEl.classList.add('bg-success');
        dataList = dbHadirList;
    } else if (type === 'cuti') {
        titleEl.innerHTML = '<i class="fas fa-suitcase-rolling"></i> Karyawan Sedang Cuti';
        headerEl.classList.add('bg-info');
        dataList = dbCutiList;
    } else if (type === 'belum') {
        titleEl.innerHTML = '<i class="fas fa-question-circle"></i> Karyawan Belum Absen';
        headerEl.classList.add('bg-secondary');
        dataList = dbBelumList;
    }
    
    // Build Dynamic Header
    if (type === 'hadir') {
        thead.innerHTML = `<tr>
            <th class="text-start ps-4">Nama Karyawan</th>
            <th>Cabang</th>
            <th>Tipe Absen</th>
            <th>Waktu</th>
            <th>Status / Rincian</th>
            <th>Jumlah Waktu Telat</th>
        </tr>`;
    } else if (type === 'cuti') {
        thead.innerHTML = `<tr>
            <th class="text-start ps-4">Nama Karyawan</th>
            <th>Cabang</th>
            <th>Jenis Cuti</th>
        </tr>`;
    } else {
        thead.innerHTML = `<tr>
            <th class="text-start ps-4">Nama Karyawan</th>
            <th>Cabang</th>
            <th>Status</th>
        </tr>`;
    }
    
    tbody.innerHTML = '';
    
    if (dataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">Tidak ada data untuk ditampilkan.</td></tr>`;
    } else {
        dataList.forEach(item => {
            let trHtml = '';
            
            if (type === 'hadir') {
                const nama = item.users?.nama || '-';
                const cabang = item.users?.cabang || '-';
                const tipe = `<span class="badge bg-primary">${item.tipe_absen || '-'}</span>`;
                const waktu = `<span class="badge bg-light text-dark border">${item.waktu_masuk || '-'}</span>`;
                
                let statusBadges = [];
                if (item.terlambat) {
                    statusBadges.push(`<span class="badge bg-warning text-dark">Terlambat</span>`);
                }
                if (item.menit_lembur > 0) {
                    statusBadges.push(`<span class="badge bg-info text-white">Lembur</span>`);
                }
                if (statusBadges.length === 0) {
                    statusBadges.push(`<span class="badge bg-success">Tepat Waktu</span>`);
                }
                const badgeKet = statusBadges.join(' ');
                
                let totalLateMinutes = item.menit_terlambat || 0;
                if (!totalLateMinutes && item.keterangan_waktu) {
                    const matchJ = item.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
                    const matchM = item.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
                    if (matchJ || matchM) {
                        const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                        const m = matchM ? parseInt(matchM[1], 10) : 0;
                        totalLateMinutes = j * 60 + m;
                    } else {
                        const matchRaw = item.keterangan_waktu.match(/Terlambat\s+(\d+)/i);
                        if (matchRaw) totalLateMinutes = parseInt(matchRaw[1], 10);
                    }
                }

                let telatTeks = `<span class="text-muted small">0 Menit</span>`;
                if (totalLateMinutes > 0) {
                    const jam = Math.floor(totalLateMinutes / 60);
                    const m = totalLateMinutes % 60;
                    let durasiStr = '';
                    if (jam > 0 && m > 0) {
                        durasiStr = `${jam} Jam ${m} Menit`;
                    } else if (jam > 0) {
                        durasiStr = `${jam} Jam`;
                    } else {
                        durasiStr = `${m} Menit`;
                    }
                    telatTeks = `<span class="badge bg-danger text-white">${durasiStr}</span>`;
                } else if (item.terlambat) {
                    telatTeks = `<span class="badge bg-danger text-white">> 0 Menit</span>`;
                }
                
                trHtml = `<tr>
                    <td class="text-start ps-4 fw-bold">${nama}</td>
                    <td>${cabang}</td>
                    <td>${tipe}</td>
                    <td>${waktu}</td>
                    <td>${badgeKet}</td>
                    <td>${telatTeks}</td>
                </tr>`;
            } else if (type === 'cuti') {
                const nama = item.users?.nama || '-';
                const cabang = item.users?.cabang || '-';
                let jenis = 'Cuti';
                if (item.data_tambahan) {
                    const keyJenis = Object.keys(item.data_tambahan).find(k => k.toLowerCase().includes('jenis'));
                    if (keyJenis) jenis = item.data_tambahan[keyJenis];
                }
                const info = `<span class="badge bg-primary">${jenis}</span>`;
                
                trHtml = `<tr>
                    <td class="text-start ps-4 fw-bold">${nama}</td>
                    <td>${cabang}</td>
                    <td>${info}</td>
                </tr>`;
            } else if (type === 'belum') {
                const nama = item.nama || '-';
                const cabang = item.cabang || '-';
                const info = `<span class="text-muted fst-italic">Belum Absen</span>`;
                
                trHtml = `<tr>
                    <td class="text-start ps-4 fw-bold">${nama}</td>
                    <td>${cabang}</td>
                    <td>${info}</td>
                </tr>`;
            }
            
            tbody.innerHTML += trHtml;
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

let allMasterTipeAbsen = [];

async function loadTipeAbsenKantorOptions(selectedIds = null) {
    const container = document.getElementById("kantor-tipe-absen-list");
    if (!container) return;

    if (allMasterTipeAbsen.length === 0) {
        const { data } = await supabaseClient
            .from("master_tipe_absen")
            .select("*")
            .eq("is_aktif", true)
            .order("id", { ascending: true });
        allMasterTipeAbsen = data || [];
    }

    if (allMasterTipeAbsen.length === 0) {
        container.innerHTML = `<div class="col-12 text-muted small">Belum ada master tipe absen yang aktif.</div>`;
        return;
    }

    const selArray = Array.isArray(selectedIds) ? selectedIds.map(Number) : null;

    container.innerHTML = allMasterTipeAbsen.map(t => {
        const isChecked = selArray === null || selArray.length === 0 || selArray.includes(Number(t.id));
        const badgeText = t.is_checkout ? 'Pulang' : 'Masuk/Lain';
        const badgeClass = t.is_checkout ? 'bg-danger' : 'bg-success';
        return `
            <div class="col-md-6">
                <div class="form-check border rounded p-2 bg-white d-flex align-items-center me-0">
                    <input class="form-check-input ms-0 me-2 check-kantor-tipe" type="checkbox" value="${t.id}" id="kantor_tipe_${t.id}" ${isChecked ? 'checked' : ''} onchange="updateTipeAbsenAllCheckboxState()">
                    <label class="form-check-label small me-auto cursor-pointer text-start" for="kantor_tipe_${t.id}">
                        <strong>${t.nama_tipe}</strong>
                        ${t.jam_mulai ? `<br><span class="text-muted" style="font-size:0.75rem;"><i class="fas fa-clock me-1"></i>${formatWaktuGlobal(t.jam_mulai)} - ${formatWaktuGlobal(t.jam_tutup || t.batas_terlambat)}</span>` : ''}
                    </label>
                    <span class="badge ${badgeClass} ms-1" style="font-size:0.65rem;">${badgeText}</span>
                </div>
            </div>
        `;
    }).join('');

    updateTipeAbsenAllCheckboxState();
}

function toggleSelectAllTipeAbsenKantor(checked) {
    const checkboxes = document.querySelectorAll('.check-kantor-tipe');
    checkboxes.forEach(cb => cb.checked = checked);
}

function updateTipeAbsenAllCheckboxState() {
    const checkboxes = document.querySelectorAll('.check-kantor-tipe');
    const allChk = document.getElementById('chk-kantor-tipe-all');
    if (!allChk || checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    allChk.checked = allChecked;
}

window.toggleSelectAllTipeAbsenKantor = toggleSelectAllTipeAbsenKantor;
window.updateTipeAbsenAllCheckboxState = updateTipeAbsenAllCheckboxState;

async function loadDataKantor() {
    if (allMasterTipeAbsen.length === 0) {
        const { data: tipeData } = await supabaseClient.from('master_tipe_absen').select('*').eq('is_aktif', true).order('id', { ascending: true });
        allMasterTipeAbsen = tipeData || [];
    }

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
    refreshCabangDropdowns();
}

function refreshCabangDropdowns() {
    // Dropdown di Form Tambah/Edit Karyawan
    const selectCabang = document.getElementById("pilih-cabang");
    if(selectCabang) {
        const val = selectCabang.value;
        selectCabang.innerHTML = '<option value="">Pilih Kantor...</option>';
        allKantor.forEach(k => {
            if (!isSuperAdmin && k.nama !== myCabang) return;
            selectCabang.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
        });
        selectCabang.value = val;
    }

    // Dropdown di Filter Karyawan
    const filterCabang = document.getElementById("karyawan-filter-cabang");
    if (filterCabang) {
        const val = filterCabang.value;
        filterCabang.innerHTML = '<option value="">Semua Cabang</option>';
        allKantor.forEach(k => {
            if (!isSuperAdmin && k.nama !== myCabang) return;
            filterCabang.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
        });
        filterCabang.value = val;
    }
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
        
        let tipeAbsenBadges = '<span class="badge bg-secondary">Semua Tipe Absen</span>';
        if (Array.isArray(kantor.tipe_absen_ids) && kantor.tipe_absen_ids.length > 0) {
            const namaTipeList = allMasterTipeAbsen
                .filter(m => kantor.tipe_absen_ids.map(Number).includes(Number(m.id)))
                .map(m => m.nama_tipe);
            if (namaTipeList.length > 0) {
                tipeAbsenBadges = namaTipeList.map(n => `<span class="badge bg-info text-dark me-1 mb-1">${n}</span>`).join('');
            }
        }

        // Render Grid
        gridContainer.innerHTML += `
            <div class="col-md-6 col-lg-4">
                <div class="card shadow-sm h-100 border-0 dashboard-card-hover" style="border-radius: 12px; transition: transform 0.2s;">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h5 class="card-title fw-bold text-primary mb-0"><i class="fas fa-building me-2"></i>${kantor.nama}</h5>
                        </div>
                        <p class="card-text small text-muted mb-2">
                            <i class="fas fa-map-marker-alt me-2 text-danger"></i>${kantor.lat}, ${kantor.lng} (Rad: ${kantor.radius}m)
                        </p>
                        <div class="mb-3">
                            <small class="text-muted d-block mb-1"><i class="fas fa-clock me-1 text-primary"></i>Tipe Absen / Shift:</small>
                            <div>${tipeAbsenBadges}</div>
                        </div>
                        <div class="d-flex justify-content-end mt-auto border-top pt-2">
                            <button class="btn btn-sm btn-warning shadow-sm" onclick="editKantor(${kantor.id})"><i class="fas fa-edit me-1"></i>Edit</button>
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
                <td>${tipeAbsenBadges}</td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="editKantor(${kantor.id})">Edit</button>
                    ${hapusBtnTable}
                </td>
            </tr>
        `;
    });
}

function editKantor(id) {
    const kantor = allKantor.find(k => k.id == id);
    if (!kantor) return;

    document.getElementById('kantor_id').value = kantor.id;
    document.getElementById('kantor_nama').value = kantor.nama || '';
    document.getElementById('kantor_lat').value = kantor.lat || '';
    document.getElementById('kantor_lng').value = kantor.lng || '';
    document.getElementById('kantor_rad').value = kantor.radius || 100;
    document.getElementById('kantor_btn').innerText = 'Update Data Cabang';
    document.getElementById('kantor-card-header').innerText = '✏️ Edit Data Kantor';

    loadTipeAbsenKantorOptions(kantor.tipe_absen_ids);

    const modalEl = document.getElementById('modalKantor');
    modalEl.dataset.lat = kantor.lat || '';
    modalEl.dataset.lng = kantor.lng || '';

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

    loadTipeAbsenKantorOptions(null);
}

window.editKantor = editKantor;
window.batalEditKantor = batalEditKantor;

function parseT(tStr) {
    if (!tStr) return null;
    const parts = tStr.split(':');
    if (parts.length >= 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return null;
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
    
    const selectedTipeAbsenIds = Array.from(document.querySelectorAll('.check-kantor-tipe:checked')).map(cb => Number(cb.value));

    const payload = {
        nama: nama,
        lat: lat,
        lng: lng,
        radius: rad,
        tipe_absen_ids: selectedTipeAbsenIds
    };

    let res = id
        ? await supabaseClient.from('kantor').update(payload).eq('id', id)
        : await supabaseClient.from('kantor').insert([payload]);

    const isMissingColumnError = res.error && (
        (res.error.message && res.error.message.toLowerCase().includes("tipe_absen_ids")) ||
        (res.error.details && res.error.details.toLowerCase().includes("tipe_absen_ids")) ||
        res.error.code === "42703"
    );
    
    // Fallback HANYA jika error spesifik karena kolom tipe_absen_ids belum terdeteksi oleh Supabase/PostgREST
    if (isMissingColumnError) {
        console.warn("Kolom tipe_absen_ids belum terdeteksi di DB. Mencoba simpan fallback tanpa tipe_absen_ids...");
        delete payload.tipe_absen_ids;
        res = id
            ? await supabaseClient.from('kantor').update(payload).eq('id', id)
            : await supabaseClient.from('kantor').insert([payload]);

        if (!res.error) {
            btn.disabled = false;
            Swal.fire({
                title: "Data Kantor Disimpan (Perhatian)",
                html: `Data kantor berhasil disimpan, namun kolom <code>tipe_absen_ids</code> belum terdeteksi oleh API Supabase.<br><br>Jalankan 2 perintah ini di <strong>SQL Editor Supabase</strong> Anda lalu muat ulang halaman:<br><pre class="bg-dark text-light p-2 rounded text-start mt-2">ALTER TABLE kantor ADD COLUMN IF NOT EXISTS tipe_absen_ids JSONB DEFAULT '[]'::jsonb;\nNOTIFY pgrst, 'reload schema';</pre>`,
                icon: "warning"
            });
            batalEditKantor();
            loadDataKantor();
            const modalKantorEl = document.getElementById('modalKantor');
            const modalKantor = bootstrap.Modal.getInstance(modalKantorEl);
            if (modalKantor) modalKantor.hide();
            return;
        }
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
                            <small class="text-primary d-block mt-1"><i class="fas fa-layer-group me-1"></i> ${user.unit || 'Unit: -'}</small>
                        </div>
                    </div>
                </div>
            `;
        });
    } else {
        grid.classList.add('d-none');
        tableContainer.classList.remove('d-none');
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Tidak ada pengguna yang cocok.</td></tr>';
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
                    <td><span class="badge bg-light text-dark border">${user.unit || '-'}</span></td>
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
    if (document.getElementById("detail_unit")) {
        document.getElementById("detail_unit").innerText = user.unit || '-';
    }
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

function handleSupabaseError(error, contextMessage = "Terjadi kesalahan") {
    if (!error) return false;
    const msg = error.message || "";

    // Deteksi error kolom missing 'unit' di tabel 'users'
    if (msg.includes("'unit'") || msg.includes("column \"unit\"") || (msg.includes("unit") && msg.includes("users"))) {
        Swal.fire({
            title: "Peringatan Skema Database (Kolom 'unit')",
            html: `
                <div class="text-start">
                    <p class="mb-2 text-danger font-monospace small">${msg}</p>
                    <p class="mb-2">Gagal memproses bidang <strong>Unit / Departemen</strong> karena kolom <code>unit</code> belum terdeteksi di tabel <code>users</code> database Supabase Anda.</p>
                    <hr class="my-2">
                    <p class="mb-1 fw-bold text-dark"><i class="fas fa-tools me-1 text-primary"></i>Cara Mengatasinya:</p>
                    <p class="small text-muted mb-2">Jalankan 2 perintah SQL berikut di <strong>SQL Editor Supabase</strong> Anda, lalu muat ulang halaman:</p>
                    <pre class="bg-dark text-light p-2.5 rounded small font-monospace text-start">ALTER TABLE users ADD COLUMN IF NOT EXISTS unit TEXT;\nNOTIFY pgrst, 'reload schema';</pre>
                </div>
            `,
            icon: "warning"
        });
        return true;
    }

    // Deteksi error kolom missing 'tipe_absen_ids' di tabel 'kantor'
    if (msg.includes("'tipe_absen_ids'") || msg.includes("column \"tipe_absen_ids\"") || (msg.includes("tipe_absen_ids") && msg.includes("kantor"))) {
        Swal.fire({
            title: "Peringatan Skema Database (Kolom 'tipe_absen_ids')",
            html: `
                <div class="text-start">
                    <p class="mb-2 text-danger font-monospace small">${msg}</p>
                    <p class="mb-2">Gagal memproses tipe absen cabang karena kolom <code>tipe_absen_ids</code> belum terdeteksi di tabel <code>kantor</code> database Supabase Anda.</p>
                    <hr class="my-2">
                    <p class="mb-1 fw-bold text-dark"><i class="fas fa-tools me-1 text-primary"></i>Cara Mengatasinya:</p>
                    <p class="small text-muted mb-2">Jalankan 2 perintah SQL berikut di <strong>SQL Editor Supabase</strong> Anda, lalu muat ulang halaman:</p>
                    <pre class="bg-dark text-light p-2.5 rounded small font-monospace text-start">ALTER TABLE kantor ADD COLUMN IF NOT EXISTS tipe_absen_ids JSONB DEFAULT '[]'::jsonb;\nNOTIFY pgrst, 'reload schema';</pre>
                </div>
            `,
            icon: "warning"
        });
        return true;
    }

    // Default error alert
    Swal.fire("Gagal", msg || contextMessage, "error");
    return false;
}

async function simpanKaryawan(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const id = document.getElementById("karyawan_id").value;
    const role = document.getElementById("role-karyawan").value;
    const nama = document.getElementById("karyawan_nama").value;
    const no_hp = document.getElementById("karyawan_hp").value;
    const password = document.getElementById("karyawan_password").value;
    const cabang = document.getElementById("pilih-cabang").value;
    const unit = document.getElementById("karyawan_unit") ? document.getElementById("karyawan_unit").value.trim() : "";
    
    const liburCheckboxes = document.querySelectorAll('.form-libur-baru');
    const checkedLibur = Array.from(liburCheckboxes).filter(c => c.checked).map(c => c.value).join(',');

    let res;
    if (id) {
        // Edit Mode
        const targetUserId = parseInt(id, 10);
        const updateData = { nama, no_hp, cabang, unit, hari_libur: checkedLibur };
        
        // Super Admin boleh ubah role
        if (isSuperAdmin) {
            updateData.role = role;
        }
        
        let { data, error } = await supabaseClient.from('users').update(updateData).eq('id', targetUserId).select();
        
        // Fallback jika 'unit' belum ada di DB
        if (error && (error.message.includes("'unit'") || error.message.includes("unit"))) {
            console.warn("Kolom unit belum ada di DB. Mencoba update tanpa kolom unit...");
            delete updateData.unit;
            const resFallback = await supabaseClient.from('users').update(updateData).eq('id', targetUserId).select();
            if (!resFallback.error && resFallback.data && resFallback.data.length > 0) {
                if (password.trim() !== '') {
                    await supabaseClient.rpc('admin_change_password', {
                        p_user_id: targetUserId,
                        p_new_password: password
                    });
                }
                btn.disabled = false;
                Swal.fire({
                    title: "Data Karyawan Disimpan (Perhatian)",
                    html: `
                        <div class="text-start">
                            <p class="mb-2">Data Karyawan berhasil diperbarui, namun bidang <strong>Unit</strong> belum tersimpan karena kolom <code>unit</code> belum ada di tabel <code>users</code> database Supabase Anda.</p>
                            <hr class="my-2">
                            <p class="mb-1 fw-bold text-dark"><i class="fas fa-tools me-1 text-primary"></i>Cara Mengatasinya:</p>
                            <p class="small text-muted mb-2">Jalankan 2 perintah SQL ini di <strong>SQL Editor Supabase</strong> Anda:</p>
                            <pre class="bg-dark text-light p-2.5 rounded small font-monospace">ALTER TABLE users ADD COLUMN IF NOT EXISTS unit TEXT;\nNOTIFY pgrst, 'reload schema';</pre>
                        </div>
                    `,
                    icon: "warning"
                });
                batalEditKaryawan();
                loadDataKaryawan();
                const modalEl = document.getElementById('modalKaryawan');
                const modalK = bootstrap.Modal.getInstance(modalEl);
                if (modalK) modalK.hide();
                return;
            }
            error = resFallback.error;
            data = resFallback.data;
        }
        
        if (error) {
            btn.disabled = false;
            handleSupabaseError(error, "Gagal memperbarui data karyawan");
            return;
        }

        // PENTING: Jika 0 baris diperbarui (dikarenakan RLS Policy lama memblokir update)
        if (!data || data.length === 0) {
            btn.disabled = false;
            Swal.fire({
                title: "Gagal Mengubah Data (Ditolak RLS)",
                html: `
                    <div class="text-start">
                        <p class="mb-2">Perintah update terkirim tetapi <strong>0 baris di database yang diperbarui</strong>.</p>
                        <p class="mb-2 small text-muted">Penyebabnya adalah Kebijakan Keamanan (<em>RLS Policy</em>) lama pada tabel <code>users</code> di database Anda memblokir izin UPDATE.</p>
                        <hr class="my-2">
                        <p class="mb-1 fw-bold text-dark"><i class="fas fa-tools me-1 text-primary"></i>Cara Mengatasinya:</p>
                        <p class="small text-muted mb-2">Jalankan perintah SQL berikut di <strong>SQL Editor Supabase</strong> Anda:</p>
                        <pre class="bg-dark text-light p-2.5 rounded small font-monospace text-start">DROP POLICY IF EXISTS "Allow auth update users" ON users;\nCREATE POLICY "Allow auth update users" ON users FOR UPDATE USING (auth.role() = 'authenticated');\nNOTIFY pgrst, 'reload schema';</pre>
                    </div>
                `,
                icon: "error"
            });
            return;
        }

        // Hanya update password jika diisi
        if (password.trim() !== '') {
            const { error: rpcError } = await supabaseClient.rpc('admin_change_password', {
                p_user_id: targetUserId,
                p_new_password: password
            });
            if (rpcError) {
                btn.disabled = false;
                Swal.fire("Gagal Ubah Password", rpcError.message, "error");
                return;
            }
        }
        res = { error: null };
    } else {
        // Insert Mode (Karyawan Baru)
        if (!password) {
            Swal.fire("Gagal", "Password wajib diisi untuk karyawan baru", "error");
            btn.disabled = false;
            return;
        }
        
        const insertData = { nama, password, role, no_hp, cabang, unit, hari_libur: checkedLibur, sisa_cuti: 12 };
        res = await supabaseClient.from('users').insert([insertData]);

        // Fallback jika 'unit' belum ada di DB
        if (res.error && (res.error.message.includes("'unit'") || res.error.message.includes("unit"))) {
            console.warn("Kolom unit belum ada di DB. Mencoba insert tanpa kolom unit...");
            delete insertData.unit;
            res = await supabaseClient.from('users').insert([insertData]);
            if (!res.error) {
                btn.disabled = false;
                Swal.fire({
                    title: "Data Karyawan Disimpan (Perhatian)",
                    html: `
                        <div class="text-start">
                            <p class="mb-2">Data Karyawan berhasil ditambahkan, namun bidang <strong>Unit</strong> belum tersimpan karena kolom <code>unit</code> belum ada di tabel <code>users</code> database Supabase Anda.</p>
                            <hr class="my-2">
                            <p class="mb-1 fw-bold text-dark"><i class="fas fa-tools me-1 text-primary"></i>Cara Mengatasinya:</p>
                            <p class="small text-muted mb-2">Jalankan 2 perintah SQL ini di <strong>SQL Editor Supabase</strong> Anda:</p>
                            <pre class="bg-dark text-light p-2.5 rounded small font-monospace">ALTER TABLE users ADD COLUMN IF NOT EXISTS unit TEXT;\nNOTIFY pgrst, 'reload schema';</pre>
                        </div>
                    `,
                    icon: "warning"
                });
                batalEditKaryawan();
                loadDataKaryawan();
                const modalEl = document.getElementById('modalKaryawan');
                const modalK = bootstrap.Modal.getInstance(modalEl);
                if (modalK) modalK.hide();
                return;
            }
        }
    }

    btn.disabled = false;
    if (res.error) {
        handleSupabaseError(res.error, "Gagal menyimpan data karyawan");
        return;
    }
    
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

    const user = allKaryawan.find(u => u.id == id);
    if (document.getElementById("karyawan_unit")) {
        document.getElementById("karyawan_unit").value = user ? (user.unit || '') : '';
    }
    
    document.getElementById("karyawan_password").value = ''; // Kosongkan password
    document.getElementById("karyawan_password").placeholder = "Isi jika ingin ganti password";
    
    // Setup checkboxes untuk hari libur
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
    if (document.getElementById("karyawan_unit")) document.getElementById("karyawan_unit").value = '';
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

let globalMasterTipeAbsen = [];

async function loadDataAbsensi(showSkeleton = true) {
    const gridContainer = document.getElementById("absensi-grid-container");
    const filterBulan = document.getElementById("filter-bulan-absensi");
    if (!gridContainer || !filterBulan) return;
    
    // Fetch master_tipe_absen untuk detail
    const { data: tipeData } = await supabaseClient.from('master_tipe_absen').select('*').order('id', { ascending: true });
    globalMasterTipeAbsen = tipeData || [];
    
    // Set default filter ke bulan ini jika kosong
    if (!filterBulan.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        filterBulan.value = `${yyyy}-${mm}`;
    }

    const [year, month] = filterBulan.value.split('-');
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    const expMulai = document.getElementById("export_mulai");
    const expSelesai = document.getElementById("export_selesai");
    if (expMulai && !expMulai.value) expMulai.value = startDate;
    if (expSelesai && !expSelesai.value) expSelesai.value = endDate;

    if (showSkeleton && (!allAbsensiGrouped || Object.keys(allAbsensiGrouped).length === 0)) {
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
    }

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
        if (showSkeleton) gridContainer.innerHTML = `<div class="col-12"><div class="alert alert-danger">Gagal memuat absensi: ${error.message}</div></div>`;
        return;
    }

    let qTotal = supabaseClient.from('users').select('id');
    if (!isSuperAdmin) qTotal = qTotal.eq('cabang', myCabang);
    const { data: usersDataTotal } = await qTotal;
    const totalUsersCount = usersDataTotal ? usersDataTotal.length : 0;

    if (!data || data.length === 0) {
        gridContainer.innerHTML = '<div class="col-12"><div class="alert alert-light text-center border">Belum ada data absensi di bulan ini.</div></div>';
        allAbsensiGrouped = {};
        if (currentAbsensiTanggal && typeof showDetailAbsensi === 'function') {
            showDetailAbsensi(currentAbsensiTanggal, currentAbsensiDateStr);
        }
        return;
    }

    // Grouping by date
    allAbsensiGrouped = {};
    data.forEach(absen => {
        if (!allAbsensiGrouped[absen.tanggal]) {
            allAbsensiGrouped[absen.tanggal] = { 
                records: [], 
                hadirSet: new Set(), 
                terlambatSet: new Set(), 
                alpha: 0, 
                cuti: 0 
            };
        }
        allAbsensiGrouped[absen.tanggal].records.push(absen);
        
        if (absen.status === 'Alpha') {
            allAbsensiGrouped[absen.tanggal].alpha++;
        } else if (absen.status === 'Cuti') {
            allAbsensiGrouped[absen.tanggal].cuti++;
        } else {
            // Semua status lain (Hadir, Tepat Waktu, Terlambat, Lembur) masuk ke hadirSet
            allAbsensiGrouped[absen.tanggal].hadirSet.add(absen.user_id);
            if (absen.status === 'Terlambat') {
                allAbsensiGrouped[absen.tanggal].terlambatSet.add(absen.user_id);
            }
        }
    });

    let gridCardsHtml = '';
    Object.keys(allAbsensiGrouped).forEach(tanggal => {
        const d = allAbsensiGrouped[tanggal];
        d.hadir = d.hadirSet.size;
        d.terlambat = d.terlambatSet.size;
        
        let dateStr = tanggal;
        try {
            const [yyyy, mm, dd] = tanggal.split('-');
            const dateObj = new Date(yyyy, parseInt(mm, 10) - 1, dd);
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateStr = dateObj.toLocaleDateString('id-ID', options);
        } catch(e) {
            dateStr = tanggal;
        }
        
        const tidakAbsen = totalUsersCount - d.hadir - d.cuti;

        gridCardsHtml += `
            <div class="col-md-6 col-lg-4 col-xl-3 mb-3">
                <div class="card shadow-sm h-100 border-0 dashboard-card-hover" style="border-radius: 12px; transition: transform 0.2s;">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-3">
                            <h6 class="card-title fw-bold text-primary mb-0"><i class="fas fa-calendar-day me-2"></i>${dateStr}</h6>
                        </div>
                        <div class="d-flex flex-column gap-2 mb-4">
                            <div class="d-flex justify-content-between align-items-center px-2">
                                <span class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i>Absen</span>
                                <span class="fw-bold">${d.hadir}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center px-2">
                                <span class="text-muted small"><i class="fas fa-times-circle text-danger me-1"></i>Tidak Absen</span>
                                <span class="fw-bold">${tidakAbsen < 0 ? 0 : tidakAbsen}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center px-2 border-top pt-1 mt-1">
                                <span class="text-muted small"><i class="fas fa-umbrella-beach text-info me-1"></i>Cuti / Izin</span>
                                <span class="fw-bold">${d.cuti}</span>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-auto">
                            <button class="btn btn-sm btn-outline-primary w-50 fw-bold shadow-sm" onclick="showDetailAbsensi('${tanggal}')">
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
    gridContainer.innerHTML = gridCardsHtml;

    // Refresh page view detail if currently open
    const pageView = document.getElementById("absensi-detail-page-view");
    if (pageView && !pageView.classList.contains("d-none") && currentAbsensiTanggal) {
        showDetailAbsensi(currentAbsensiTanggal, currentAbsensiDateStr);
    }
}

let currentAbsensiTanggal = null;
let currentAbsensiDateStr = null;

function showDetailAbsensi(tanggal, dateStrParam) {
    currentAbsensiTanggal = tanggal;

    let dateStr = dateStrParam;
    if (!dateStr) {
        try {
            const [yyyy, mm, dd] = tanggal.split('-');
            const dateObj = new Date(yyyy, parseInt(mm, 10) - 1, dd);
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateStr = dateObj.toLocaleDateString('id-ID', options);
        } catch(e) {
            dateStr = tanggal;
        }
    }
    currentAbsensiDateStr = dateStr;

    // Switch view to Page View section
    const gridView = document.getElementById("absensi-grid-view");
    const pageView = document.getElementById("absensi-detail-page-view");
    if (gridView) gridView.classList.add("d-none");
    if (pageView) pageView.classList.remove("d-none");

    const pageTitle = document.getElementById("pageDetailAbsensiTitle");
    if (pageTitle) pageTitle.innerHTML = `<i class="fas fa-calendar-day me-2"></i>Detail Absensi - ${dateStr}`;

    const searchInputPage = document.getElementById("searchDetailAbsensiPage");
    if (searchInputPage) searchInputPage.value = '';

    const thead = document.getElementById("pageDetailAbsensiHead") || document.getElementById("modalDetailAbsensiHead");
    const tbody = document.getElementById("pageDetailAbsensiBody") || document.getElementById("modalDetailAbsensiBody");
    
    if (thead) thead.innerHTML = '';
    if (tbody) tbody.innerHTML = '';
    
    const records = allAbsensiGrouped[tanggal]?.records || [];
    
    if (records.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td class="text-center py-4 text-muted">Tidak ada data detail absensi</td></tr>`;
        return;
    }

    // 1. Group records by Employee and get unique tipe_absen
    const grouped = {};
    
    let tipeAbsenList = [];
    if (typeof globalMasterTipeAbsen !== 'undefined') {
        tipeAbsenList = globalMasterTipeAbsen.filter(t => t.is_aktif).map(t => t.nama_tipe);
    }
    
    records.forEach(row => {
        const namaUser = row.users?.nama || 'Unknown';
        const cabangUser = row.users?.cabang || '-';
        
        if (!grouped[namaUser]) {
            grouped[namaUser] = { nama: namaUser, cabang: cabangUser, absensi: {}, allRows: [] };
        }
        
        const tipe = row.tipe_absen || 'Unknown';
        if (!tipeAbsenList.includes(tipe)) {
            tipeAbsenList.push(tipe);
        }
        
        if (!grouped[namaUser].absensi[tipe]) {
            grouped[namaUser].absensi[tipe] = [];
        }
        grouped[namaUser].absensi[tipe].push(row);
        grouped[namaUser].allRows.push(row);
    });
    
    // 2. Build Dynamic Header
    let trHead = `<tr><th class="text-start ps-3 align-middle" rowspan="2">Karyawan</th><th class="align-middle" rowspan="2">Kantor</th>`;
    // Top headers for categories
    trHead += `<th colspan="${tipeAbsenList.length}">Waktu</th>`;
    trHead += `<th colspan="${tipeAbsenList.length}">Status Kehadiran</th>`;
    trHead += `<th colspan="${tipeAbsenList.length}">Lokasi / Jarak</th>`;
    trHead += `<th colspan="${tipeAbsenList.length}">Foto Muka</th>`;
    trHead += `<th class="align-middle text-center" rowspan="2">Jam Kerja</th>`;
    trHead += `<th class="align-middle text-center" rowspan="2">Jam Lembur</th>`;
    trHead += `<th class="align-middle text-center text-danger" rowspan="2">Waktu Telat</th>`;
    trHead += `<th colspan="${tipeAbsenList.length}">Aksi</th>`;
    trHead += `</tr><tr>`;
    // Sub-headers for tipe_absen within categories
    ['Waktu', 'Status', 'Lokasi', 'Foto'].forEach(() => {
        tipeAbsenList.forEach(tipe => {
            trHead += `<th><span class="badge bg-secondary">${tipe}</span></th>`;
        });
    });
    // For Aksi
    tipeAbsenList.forEach(tipe => {
        trHead += `<th><span class="badge bg-secondary">${tipe}</span></th>`;
    });
    trHead += `</tr>`;
    if (thead) thead.innerHTML = trHead;

    // 3. Build Body Rows
    let tbodyRowsHtml = '';
    for (const namaUser in grouped) {
        const g = grouped[namaUser];
        let trHtml = `<tr>
            <td class="text-start ps-3 fw-bold align-middle">${g.nama}</td>
            <td class="align-middle">${g.cabang}</td>`;
            
        // Waktu
        tipeAbsenList.forEach(tipe => {
            const list = g.absensi[tipe] || [];
            if (list.length > 0) {
                const timeBadges = list.map(a => {
                    const statusStr = (a.status || '').toLowerCase();
                    const tipeStr = (tipe || '').toLowerCase();
                    const ketStr = (a.keterangan_waktu || '').toLowerCase();

                    let limitMin = null;
                    if (typeof globalMasterTipeAbsen !== 'undefined' && globalMasterTipeAbsen) {
                        const mObj = globalMasterTipeAbsen.find(m => m.nama_tipe === tipe) || globalMasterTipeAbsen.find(m => m.is_checkout);
                        if (mObj && (mObj.is_checkout || tipeStr.includes('pulang') || tipeStr.includes('checkout'))) {
                            const endStr = mObj.batas_terlambat || (mObj.jam_tutup && mObj.jam_tutup !== '23:59:59' ? mObj.jam_tutup : null);
                            if (endStr) limitMin = parseT(endStr);
                        }
                    }
                    const wMin = parseT(a.waktu);
                    const isExceedingEnd = (limitMin !== null && wMin !== null && wMin > limitMin);

                    const isLemburRecord = a.status === "Lembur" || 
                                           (a.menit_lembur && parseInt(a.menit_lembur, 10) > 0) || 
                                           tipeStr.includes('lembur') || 
                                           statusStr.includes('lembur') || 
                                           ketStr.includes('lembur') || 
                                           isExceedingEnd;

                    const isTerlambatRecord = a.status === "Terlambat" || 
                                              (a.menit_terlambat && parseInt(a.menit_terlambat, 10) > 0) || 
                                              statusStr.includes('terlambat') || 
                                              ketStr.includes('terlambat');

                    let badgeClass = "bg-light text-dark border";
                    if (isLemburRecord) {
                        badgeClass = "bg-success text-white";
                    } else if (isTerlambatRecord) {
                        badgeClass = "bg-warning text-dark";
                    }

                    return `<span class="badge ${badgeClass} d-block mb-1" title="${a.keterangan_waktu || a.status}">${formatWaktuGlobal(a.waktu)}</span>`;
                }).join('');
                trHtml += `<td class="align-middle">${timeBadges}</td>`;
            } else {
                trHtml += `<td class="align-middle text-muted">-</td>`;
            }
        });
        
        // Status
        tipeAbsenList.forEach(tipe => {
            const list = g.absensi[tipe] || [];
            if (list.length > 0) {
                let statusHtml = '';
                list.forEach(a => {
                    const statusStr = (a.status || '').toLowerCase();
                    const tipeStr = (tipe || '').toLowerCase();
                    const ketStr = (a.keterangan_waktu || '').toLowerCase();

                    let limitMin = null;
                    if (typeof globalMasterTipeAbsen !== 'undefined' && globalMasterTipeAbsen) {
                        const mObj = globalMasterTipeAbsen.find(m => m.nama_tipe === tipe) || globalMasterTipeAbsen.find(m => m.is_checkout);
                        if (mObj && (mObj.is_checkout || tipeStr.includes('pulang') || tipeStr.includes('checkout'))) {
                            const endStr = mObj.batas_terlambat || (mObj.jam_tutup && mObj.jam_tutup !== '23:59:59' ? mObj.jam_tutup : null);
                            if (endStr) limitMin = parseT(endStr);
                        }
                    }
                    const wMin = parseT(a.waktu);
                    const isExceedingEnd = (limitMin !== null && wMin !== null && wMin > limitMin);

                    const isLemburRecord = a.status === "Lembur" || 
                                           (a.menit_lembur && parseInt(a.menit_lembur, 10) > 0) || 
                                           tipeStr.includes('lembur') || 
                                           statusStr.includes('lembur') || 
                                           ketStr.includes('lembur') || 
                                           isExceedingEnd;

                    let displayStatus = a.status || 'Hadir';
                    if (isLemburRecord && displayStatus === 'Hadir') displayStatus = 'Lembur';

                    let badgeClass = "bg-secondary";
                    if (isLemburRecord) badgeClass = "bg-success";
                    else if (a.status === "Hadir" || a.status === "Tepat Waktu") badgeClass = "bg-success";
                    else if (a.status === "Terlambat") badgeClass = "bg-warning text-dark";
                    else if (a.status === "Alpha") badgeClass = "bg-danger";
                    else if (a.status === "Cuti") badgeClass = "bg-info text-dark";
                    else if (a.status === "Istirahat") badgeClass = "bg-primary";
                    
                    let faceBadgeClass = "bg-secondary";
                    const faceStatus = a.status_wajah || "Sesuai";
                    if (faceStatus.includes("Dicurigai") || faceStatus.includes("Tidak Sama")) faceBadgeClass = "bg-danger";
                    else if (faceStatus.includes("Sesuai") || faceStatus.includes("Sama")) faceBadgeClass = "bg-success";

                    statusHtml += `<div class="mb-1 text-center">
                        <span class="badge ${badgeClass} mb-1 w-100">${displayStatus}</span><br>
                        <span class="badge ${faceBadgeClass} w-100" title="Status Wajah"><i class="fas fa-user-check"></i> ${faceStatus}</span>
                    </div>`;
                });
                trHtml += `<td class="align-middle" style="min-width: 130px;">${statusHtml}</td>`;
            } else {
                trHtml += `<td class="align-middle text-muted">-</td>`;
            }
        });
        
        // Lokasi
        tipeAbsenList.forEach(tipe => {
            const list = g.absensi[tipe] || [];
            if (list.length > 0) {
                const locHtml = list.map(a => `<div class="small text-muted mb-1">${a.lokasi || '-'}</div>`).join('');
                trHtml += `<td class="align-middle">${locHtml}</td>`;
            } else {
                trHtml += `<td class="align-middle text-muted small fst-italic">-</td>`;
            }
        });
        
        // Foto
        tipeAbsenList.forEach(tipe => {
            const list = g.absensi[tipe] || [];
            if (list.length > 0) {
                const fotoHtml = list.map(a => a.foto ? `<button class="btn btn-sm btn-info text-white shadow-sm mb-1 d-block w-100" onclick="lihatFotoAbsenSingle('${a.foto}')">📸 Lihat</button>` : `<div class="text-muted small fst-italic mb-1">-</div>`).join('');
                trHtml += `<td class="align-middle">${fotoHtml}</td>`;
            } else {
                trHtml += `<td class="align-middle text-muted small fst-italic">-</td>`;
            }
        });
        
        // Hitung Jam Kerja & Lembur berdasarkan allRows
        let jamKerjaStr = '-';
        let jamLemburStr = '-';


        const formatM = (m) => {
            if (m <= 0) return '0j 0m';
            return `${Math.floor(m / 60)}j ${m % 60}m`;
        };

        const allRows = g.allRows || [];
        
        // 1. Cari Waktu Masuk Pertama
        const masukRows = allRows.filter(r => {
            const name = (r.tipe_absen || '').toLowerCase();
            return name.includes('masuk') && !name.includes('izin') && !name.includes('istirahat');
        });
        let waktuMasukMin = null;
        if (masukRows.length > 0) {
            masukRows.sort((a, b) => (a.waktu || '').localeCompare(b.waktu || ''));
            waktuMasukMin = parseT(masukRows[0].waktu);
        }

        // 2. Cari Waktu Pulang / Checkout Terakhir
        const pulangRows = allRows.filter(r => {
            const name = (r.tipe_absen || '').toLowerCase();
            return name.includes('pulang') || name.includes('checkout');
        });
        let waktuPulangMin = null;
        let jamPulangResmiMin = null;

        if (pulangRows.length > 0) {
            pulangRows.sort((a, b) => (b.waktu || '').localeCompare(a.waktu || ''));
            const lastPulang = pulangRows[0];
            waktuPulangMin = parseT(lastPulang.waktu);

            const masterTarget = (globalMasterTipeAbsen || []).find(m => m.nama_tipe === lastPulang.tipe_absen) ||
                                 (globalMasterTipeAbsen || []).find(m => m.is_checkout);
            if (masterTarget) {
                jamPulangResmiMin = parseT(masterTarget.batas_terlambat || masterTarget.jam_tutup || "16:00:00");
                if (jamPulangResmiMin > 1400 && masterTarget.batas_terlambat) {
                    jamPulangResmiMin = parseT(masterTarget.batas_terlambat);
                }
            } else {
                jamPulangResmiMin = 960; // 16:00
            }
        }

        // 3. Hitung Durasi Istirahat / Izin (Siang vs Lembur)
        let istirahatSiangMins = 0;
        let istirahatLemburMins = 0;

        const istKeluarRows = allRows.filter(r => (r.tipe_absen || '').toLowerCase().includes('istirahat keluar') || (r.tipe_absen || '').toLowerCase().includes('izin keluar')).sort((a, b) => (a.waktu || '').localeCompare(b.waktu || ''));
        const istMasukRows = allRows.filter(r => (r.tipe_absen || '').toLowerCase().includes('istirahat masuk') || (r.tipe_absen || '').toLowerCase().includes('izin masuk')).sort((a, b) => (a.waktu || '').localeCompare(b.waktu || ''));

        istKeluarRows.forEach(kRow => {
            const kMin = parseT(kRow.waktu);
            if (kMin) {
                const mRow = istMasukRows.find(m => parseT(m.waktu) > kMin);
                if (mRow) {
                    const mMin = parseT(mRow.waktu);
                    const durasi = mMin - kMin;
                    if (jamPulangResmiMin && kMin >= jamPulangResmiMin) {
                        istirahatLemburMins += durasi;
                    } else {
                        istirahatSiangMins += durasi;
                    }
                }
            }
        });

        // 4. Kalkulasi Jam Lembur & Jam Kerja
        let totalDbMenitLembur = 0;
        (g.allRows || []).forEach(a => {
            let mL = parseInt(a.menit_lembur, 10) || 0;
            if (!mL && a.keterangan_waktu && a.keterangan_waktu.toLowerCase().includes('lembur')) {
                const matchJ = a.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
                const matchM = a.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
                if (matchJ || matchM) {
                    const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                    const m = matchM ? parseInt(matchM[1], 10) : 0;
                    mL = j * 60 + m;
                }
            }
            if (mL > 0) totalDbMenitLembur = Math.max(totalDbMenitLembur, mL);
        });

        if (waktuPulangMin && jamPulangResmiMin && waktuPulangMin > jamPulangResmiMin) {
            const lemburKotor = waktuPulangMin - jamPulangResmiMin;
            const lemburBersih = Math.max(0, lemburKotor - istirahatLemburMins);
            jamLemburStr = formatM(Math.max(lemburBersih, totalDbMenitLembur));
        } else if (totalDbMenitLembur > 0) {
            jamLemburStr = formatM(totalDbMenitLembur);
        } else if (waktuPulangMin) {
            jamLemburStr = '0j 0m';
        }

        if (waktuMasukMin && waktuPulangMin) {
            const batasAkhirKerja = jamPulangResmiMin && waktuPulangMin > jamPulangResmiMin ? jamPulangResmiMin : waktuPulangMin;
            if (batasAkhirKerja >= waktuMasukMin) {
                const kerjaKotor = batasAkhirKerja - waktuMasukMin;
                const kerjaBersih = Math.max(0, kerjaKotor - istirahatSiangMins);
                jamKerjaStr = formatM(kerjaBersih);
            }
        }

        let totalTelatMins = 0;
        (g.allRows || []).forEach(a => {
            if (a.menit_terlambat && parseInt(a.menit_terlambat, 10) > 0) {
                totalTelatMins += parseInt(a.menit_terlambat, 10);
            }
        });
        
        let telatCellHtml = `<span class="text-muted small">0m</span>`;
        if (totalTelatMins > 0) {
            const j = Math.floor(totalTelatMins / 60);
            const m = totalTelatMins % 60;
            const telatStr = `${j > 0 ? j + 'j ' : ''}${m}m`;
            telatCellHtml = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1">${telatStr}</span>`;
        }

        trHtml += `<td class="align-middle text-center fw-bold text-success">${jamKerjaStr}</td>`;
        trHtml += `<td class="align-middle text-center fw-bold text-warning">${jamLemburStr}</td>`;
        trHtml += `<td class="align-middle text-center fw-bold">${telatCellHtml}</td>`;
        
        // Aksi
        tipeAbsenList.forEach(tipe => {
            const list = g.absensi[tipe] || [];
            if (list.length > 0) {
                const aksiHtml = list.map(a => `
                    <div class="d-flex flex-column gap-1 my-1">
                        <button class="btn btn-sm btn-warning text-dark shadow-sm fw-bold w-100" onclick="bukaModalEditAbsensi('${a.id}', '${a.tipe_absen}', '${a.waktu}', '${tanggal}')" title="Edit / Pindah Shift ${tipe}">
                            <i class="fas fa-edit me-1"></i>Edit
                        </button>
                        <button class="btn btn-sm btn-danger shadow-sm text-white w-100" onclick="hapusDataAbsen('${a.id}', '${tanggal}')" title="Hapus ${tipe}">
                            <i class="fas fa-trash-alt me-1"></i>Hapus
                        </button>
                    </div>
                `).join('');
                trHtml += `<td class="align-middle" style="min-width: 110px;">${aksiHtml}</td>`;
            } else {
                trHtml += `<td class="align-middle text-muted">-</td>`;
            }
        });

        trHtml += `</tr>`;
        tbodyRowsHtml += trHtml;
    }
    
    if (tbody) tbody.innerHTML = tbodyRowsHtml;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterDetailAbsensiPage() {
    const input = document.getElementById("searchDetailAbsensiPage");
    if (!input) return;
    const filter = input.value.toLowerCase();
    const tbody = document.getElementById("pageDetailAbsensiBody");
    if (!tbody) return;
    const trs = tbody.getElementsByTagName("tr");
    
    for (let i = 0; i < trs.length; i++) {
        const tr = trs[i];
        const textValue = tr.textContent || tr.innerText;
        if (textValue.toLowerCase().indexOf(filter) > -1) {
            tr.style.display = "";
        } else {
            tr.style.display = "none";
        }
    }
}
window.filterDetailAbsensiPage = filterDetailAbsensiPage;

function filterDetailAbsensi() {
    filterDetailAbsensiPage();
}
window.filterDetailAbsensi = filterDetailAbsensi;

function tutupDetailAbsensiPage() {
    const gridView = document.getElementById("absensi-grid-view");
    const pageView = document.getElementById("absensi-detail-page-view");
    if (gridView) gridView.classList.remove("d-none");
    if (pageView) pageView.classList.add("d-none");
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.tutupDetailAbsensiPage = tutupDetailAbsensiPage;

function exportCsvCurrentDetail() {
    if (currentAbsensiTanggal) {
        exportCsvHarian(currentAbsensiTanggal);
    }
}
window.exportCsvCurrentDetail = exportCsvCurrentDetail;

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
        const escapeCSV = (str) => '"' + String(str).replace(/"/g, '""') + '"';

        // 1. Group records by Employee
        const grouped = {};
        
        let tipeAbsenList = [];
        if (typeof globalMasterTipeAbsen !== 'undefined') {
            tipeAbsenList = globalMasterTipeAbsen.filter(t => t.is_aktif).map(t => t.nama_tipe);
        }
        
        records.forEach(row => {
            const namaUser = row.users?.nama || 'Unknown';
            const cabangUser = row.users?.cabang || '-';
            
            if (!grouped[namaUser]) {
                grouped[namaUser] = {
                    nama: namaUser,
                    cabang: cabangUser,
                    absensi: {}
                };
            }
            
            const tipe = row.tipe_absen || 'Unknown';
            if (!tipeAbsenList.includes(tipe)) {
                tipeAbsenList.push(tipe);
            }
            
            grouped[namaUser].absensi[tipe] = {
                waktu: row.waktu || '-',
                status: row.status || '-',
                jarak: row.lokasi || '-',
                foto: row.foto || ''
            };
        });

        // 2. Build 2-Tier Header
        const nTypes = tipeAbsenList.length;
        const emptyCols = nTypes > 1 ? ','.repeat(nTypes - 1) : '';
        
        let headerRow1 = "Tanggal,Nama,Cabang";
        headerRow1 += `,"Waktu"${emptyCols}`;
        headerRow1 += `,"Status Kehadiran"${emptyCols}`;
        headerRow1 += `,"Lokasi / Jarak"${emptyCols}`;
        if (includeMedia) headerRow1 += `,"Foto Muka"${emptyCols}`;
        headerRow1 += `,"Jam Kerja","Jam Lembur"`;
        
        let headerRow2 = ",,";
        tipeAbsenList.forEach(t => headerRow2 += `,"${t}"`); // Waktu
        tipeAbsenList.forEach(t => headerRow2 += `,"${t}"`); // Status
        tipeAbsenList.forEach(t => headerRow2 += `,"${t}"`); // Jarak
        if (includeMedia) {
            tipeAbsenList.forEach(t => headerRow2 += `,"${t}"`); // Foto
        }
        headerRow2 += `,,`; // for Jam Kerja, Jam Lembur
        
        let csvContent = headerRow1 + "\n" + headerRow2 + "\n";
        
        // 3. Build CSV Rows and Handle ZIP if media is included
        let rootFolder, mediaFolder, zip;
        if (includeMedia) {
            zip = new JSZip();
            rootFolder = zip.folder(`Export_Harian_${tanggal}`);
            mediaFolder = rootFolder.folder("media");
        }

        for (const namaUser in grouped) {
            const g = grouped[namaUser];
            let cols = [
                escapeCSV(tanggal),
                escapeCSV(g.nama),
                escapeCSV(g.cabang)
            ];
            
            tipeAbsenList.forEach(tipe => {
                const a = g.absensi[tipe];
                cols.push(a ? escapeCSV(a.waktu) : "-");
            });
            tipeAbsenList.forEach(tipe => {
                const a = g.absensi[tipe];
                cols.push(a ? escapeCSV(a.status) : "-");
            });
            tipeAbsenList.forEach(tipe => {
                const a = g.absensi[tipe];
                cols.push(a ? escapeCSV(a.jarak) : "-");
            });
            if (includeMedia) {
                tipeAbsenList.forEach(tipe => {
                    const a = g.absensi[tipe];
                    cols.push(a ? escapeCSV(a.foto) : "-");
                });
            }
            
            // Hitung Jam Kerja & Lembur
            let jamKerjaStr = '-';
            let jamLemburStr = '-';
            let waktuMasuk = null;
            let waktuPulang = null;
            let batasPulang = null;
            let waktuIzinKeluar = null;
            let waktuIzinMasuk = null;
            
            if (typeof globalMasterTipeAbsen !== 'undefined') {
                globalMasterTipeAbsen.forEach(t => {
                    if (g.absensi[t.nama_tipe]) {
                        const timeStr = g.absensi[t.nama_tipe].waktu;
                        if (timeStr && timeStr !== '-') {
                            const namaTipe = t.nama_tipe.toLowerCase();
                            if (namaTipe.includes('izin keluar')) {
                                waktuIzinKeluar = timeStr;
                            } else if (namaTipe.includes('izin masuk') || namaTipe.includes('izin kembali')) {
                                waktuIzinMasuk = timeStr;
                            } else if (t.is_checkout) {
                                waktuPulang = timeStr;
                                batasPulang = t.batas_terlambat;
                            } else {
                                if (!waktuMasuk) waktuMasuk = timeStr;
                            }
                        }
                    }
                });
            }
            
            const formatM = (m) => {
                if (m <= 0) return '0j 0m';
                return `${Math.floor(m/60)}j ${m%60}m`;
            };
            
            let lemburMins = 0;
            tipeAbsenList.forEach(tipe => {
                const a = g.absensi[tipe];
                if (a) {
                    if (a.menit_lembur > 0) lemburMins = Math.max(lemburMins, a.menit_lembur);
                    else if (a.keterangan_waktu && a.keterangan_waktu.toLowerCase().includes('lembur')) {
                        const matchJ = a.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
                        const matchM = a.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
                        if (matchJ || matchM) {
                            const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                            const m = matchM ? parseInt(matchM[1], 10) : 0;
                            lemburMins = Math.max(lemburMins, j * 60 + m);
                        }
                    }
                }
            });

            if (waktuPulang && batasPulang) {
                const pMins = parseT(waktuPulang);
                const bMins = parseT(batasPulang);
                if (pMins && bMins && pMins > bMins) {
                    lemburMins = Math.max(lemburMins, pMins - bMins);
                }
            }
            
            let izinMins = 0;
            if (waktuIzinKeluar && waktuIzinMasuk) {
                const kMins = parseT(waktuIzinKeluar);
                const mMinsIzin = parseT(waktuIzinMasuk);
                if (kMins && mMinsIzin && mMinsIzin > kMins) {
                    izinMins = mMinsIzin - kMins;
                }
            }
            
            if (lemburMins > 0) {
                jamLemburStr = formatM(lemburMins);
            } else if (waktuPulang) {
                jamLemburStr = '0j 0m';
            }
            
            if (waktuMasuk && waktuPulang) {
                const mMins = parseT(waktuMasuk);
                const pMins = parseT(waktuPulang);
                if (mMins && pMins && pMins >= mMins) {
                    let kerjaMins = (pMins - mMins) - lemburMins - izinMins;
                    if (kerjaMins < 0) kerjaMins = 0;
                    jamKerjaStr = formatM(kerjaMins);
                }
            }
            
            cols.push(escapeCSV(jamKerjaStr));
            cols.push(escapeCSV(jamLemburStr));
            
            csvContent += cols.join(",") + "\n";
            
            // Download photo if ZIP
            if (includeMedia) {
                const userFolder = mediaFolder.folder(g.nama);
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
                
                for (const tipe of tipeAbsenList) {
                    const a = g.absensi[tipe];
                    if (a && a.foto) {
                        const cleanTipe = tipe.replace(/ /g, '_');
                        await simpanFoto(a.foto, `${tanggal}_${cleanTipe}.png`);
                    }
                }
            }
        }

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
        
        // 1. Hitung Rentang Tanggal
        const datesList = [];
        const [sY, sM, sD] = tglMulai.split('-').map(Number);
        const [eY, eM, eD] = tglSelesai.split('-').map(Number);
        let currDate = new Date(Date.UTC(sY, sM - 1, sD));
        const endDate = new Date(Date.UTC(eY, eM - 1, eD));

        while (currDate <= endDate) {
            const yyyy = currDate.getUTCFullYear();
            const mm = String(currDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(currDate.getUTCDate()).padStart(2, '0');
            datesList.push(`${yyyy}-${mm}-${dd}`);
            currDate.setUTCDate(currDate.getUTCDate() + 1);
        }

        // 2. Group Data (Cabang -> Nama Karyawan -> Tanggal -> Tipe Absen)
        const branchMap = {};
        let tipeAbsenList = [];
        if (typeof globalMasterTipeAbsen !== 'undefined' && globalMasterTipeAbsen.length > 0) {
            tipeAbsenList = globalMasterTipeAbsen.filter(t => t.is_aktif).map(t => t.nama_tipe);
        }

        // Ensure currentFormatWaktu is loaded
        if (!window.currentFormatWaktu) {
            try {
                const { data: setRes } = await supabaseClient.from('settings').select('format_waktu').single();
                if (setRes && setRes.format_waktu) {
                    window.currentFormatWaktu = setRes.format_waktu;
                }
            } catch(e) {}
        }

        // Ambil seluruh karyawan agar karyawan yang 0 absen tetap muncul di sheet cabang
        let qAllUsers = supabaseClient.from('users').select('id, nama, cabang').order('nama', { ascending: true });
        if (!isSuperAdmin) {
            qAllUsers = qAllUsers.eq('cabang', myCabang);
        }
        const { data: allUsersData } = await qAllUsers;

        if (allUsersData && allUsersData.length > 0) {
            allUsersData.forEach(u => {
                const namaUser = u.nama || 'Unknown';
                const cabangUser = u.cabang || 'Tanpa Cabang';
                if (!branchMap[cabangUser]) {
                    branchMap[cabangUser] = {};
                }
                branchMap[cabangUser][namaUser] = {
                    nama: namaUser,
                    cabang: cabangUser,
                    absensi: {},
                    hasAbsen: false
                };
            });
        }

        data.forEach(row => {
            const namaUser = row.users ? row.users.nama : 'Unknown';
            const cabangUser = row.users ? row.users.cabang || 'Tanpa Cabang' : 'Tanpa Cabang';
            
            if (!branchMap[cabangUser]) {
                branchMap[cabangUser] = {};
            }
            if (!branchMap[cabangUser][namaUser]) {
                branchMap[cabangUser][namaUser] = {
                    nama: namaUser,
                    cabang: cabangUser,
                    absensi: {},
                    hasAbsen: false
                };
            }
            
            branchMap[cabangUser][namaUser].hasAbsen = true;
            
            const tipe = row.tipe_absen || 'Unknown';
            if (!tipeAbsenList.includes(tipe)) {
                tipeAbsenList.push(tipe);
            }
            
            if (!branchMap[cabangUser][namaUser].absensi[row.tanggal]) {
                branchMap[cabangUser][namaUser].absensi[row.tanggal] = {};
            }
            
            const existing = branchMap[cabangUser][namaUser].absensi[row.tanggal][tipe];
            const formattedTime = row.waktu ? formatWaktuGlobal(row.waktu) : '-';

            if (!existing) {
                branchMap[cabangUser][namaUser].absensi[row.tanggal][tipe] = {
                    waktu: formattedTime,
                    status: row.status || '-',
                    jarak: row.lokasi || '-',
                    foto: row.foto || '',
                    menit_lembur: row.menit_lembur || 0,
                    keterangan_waktu: row.keterangan_waktu || ''
                };
            } else {
                // Jika ada 2x absen tipe sama di tanggal yang sama (misal 2x istirahat)
                if (existing.waktu === '-' || !existing.waktu) {
                    existing.waktu = formattedTime;
                } else if (formattedTime !== '-' && !existing.waktu.includes(formattedTime)) {
                    existing.waktu += `, ${formattedTime}`;
                }
                if (row.status && !existing.status.includes(row.status)) {
                    existing.status += ` | ${row.status}`;
                }
                if (row.menit_lembur) {
                    existing.menit_lembur = Math.max(existing.menit_lembur || 0, row.menit_lembur);
                }
                if (row.keterangan_waktu) {
                    existing.keterangan_waktu = (existing.keterangan_waktu ? existing.keterangan_waktu + ' ' : '') + row.keterangan_waktu;
                }
            }
        });

        // 3. Generate Excel File (Per Sheet = Nama Cabang)
        if (typeof XLSX !== 'undefined') {
            const wb = XLSX.utils.book_new();
            const sortedCabangs = Object.keys(branchMap).sort();
            const usedSheetNames = new Set();

            if (sortedCabangs.length === 0) {
                const headerRow = [''];
                datesList.forEach(d => headerRow.push(parseInt(d.split('-')[2], 10)));
                const ws = XLSX.utils.aoa_to_sheet([headerRow]);
                XLSX.utils.book_append_sheet(wb, ws, "Rekap Absen");
            } else {
                sortedCabangs.forEach(cabangName => {
                    const userGroupMap = branchMap[cabangName];
                    const matrixData = [];
                    const cellStylesMap = {}; // key: "r_c"

                    // Baris Header 1: Kolom A kosong, diikuti angka tanggal (1, 2, 3...)
                    const headerRow = [''];
                    datesList.forEach(d => {
                        headerRow.push(parseInt(d.split('-')[2], 10));
                    });
                    matrixData.push(headerRow);

                    // Style Baris Header Tanggal
                    for (let c = 0; c <= datesList.length; c++) {
                        cellStylesMap[`0_${c}`] = {
                            font: { bold: true },
                            fill: { fgColor: { rgb: "E9ECEF" } },
                            alignment: { horizontal: "center", vertical: "center" }
                        };
                    }

                    let currentRowIdx = 1;
                    const userNames = Object.keys(userGroupMap).sort();

                    userNames.forEach(namaUser => {
                        const userObj = userGroupMap[namaUser];
                        
                        // Baris Nama Karyawan
                        const nameRow = new Array(datesList.length + 1).fill('');
                        nameRow[0] = userObj.nama;
                        matrixData.push(nameRow);
                        
                        // Warna nama: #FFFF00 (Kuning) jika ada absen, #808080 (Abu-abu) jika 0 absen
                        const nameBgColor = userObj.hasAbsen ? "FFFF00" : "808080";
                        const nameFontColor = userObj.hasAbsen ? "000000" : "FFFFFF";
                        
                        // Style Baris Nama Karyawan
                        for (let c = 0; c <= datesList.length; c++) {
                            cellStylesMap[`${currentRowIdx}_${c}`] = {
                                font: { bold: true, color: { rgb: nameFontColor } },
                                fill: { fgColor: { rgb: nameBgColor } },
                                alignment: { horizontal: "center", vertical: "center" }
                            };
                        }
                        currentRowIdx++;
                        
                        // Baris Tipe Absen
                        tipeAbsenList.forEach(tipe => {
                            const typeRow = new Array(datesList.length + 1).fill('');
                            typeRow[0] = tipe;
                            
                            // Style Kolom A untuk Judul Tipe Absen
                            cellStylesMap[`${currentRowIdx}_0`] = {
                                font: { bold: true },
                                alignment: { horizontal: "left", vertical: "center" }
                            };
                            
                            datesList.forEach((d, dIdx) => {
                                const c = dIdx + 1;
                                const dayAbsen = userObj.absensi[d];
                                const a = dayAbsen ? dayAbsen[tipe] : null;
                                
                                if (a && a.waktu && a.waktu !== '-') {
                                    typeRow[c] = a.waktu;
                                    
                                    const statusStr = (a.status || '').toLowerCase();
                                    const tipeStr = tipe.toLowerCase();
                                    const ketStr = (a.keterangan_waktu || '').toLowerCase();

                                    let limitMin = null;
                                    if (typeof globalMasterTipeAbsen !== 'undefined' && globalMasterTipeAbsen) {
                                        const mObj = globalMasterTipeAbsen.find(m => m.nama_tipe === tipe) || globalMasterTipeAbsen.find(m => m.is_checkout);
                                        if (mObj && (mObj.is_checkout || tipeStr.includes('pulang') || tipeStr.includes('checkout'))) {
                                            const endStr = mObj.batas_terlambat || (mObj.jam_tutup && mObj.jam_tutup !== '23:59:59' ? mObj.jam_tutup : null);
                                            if (endStr) limitMin = parseT(endStr);
                                        }
                                    }
                                    const wMin = parseT(a.waktu);
                                    const isExceedingEnd = (limitMin !== null && wMin !== null && wMin > limitMin);

                                    const isTerlambat = statusStr.includes('terlambat');
                                    const isLembur = tipeStr.includes('lembur') || statusStr.includes('lembur') || (a.menit_lembur && a.menit_lembur > 0) || ketStr.includes('lembur') || isExceedingEnd;
                                    
                                    let bgColor = null;
                                    if (isTerlambat) {
                                        bgColor = "FFA6A6"; // Terlambat: #FFA6A6
                                    } else if (isLembur) {
                                        bgColor = "AFD095"; // Lembur: #AFD095
                                    }
                                    
                                    cellStylesMap[`${currentRowIdx}_${c}`] = {
                                        alignment: { horizontal: "center", vertical: "center" },
                                        ...(bgColor ? { fill: { fgColor: { rgb: bgColor } } } : {})
                                    };
                                } else {
                                    cellStylesMap[`${currentRowIdx}_${c}`] = {
                                        alignment: { horizontal: "center", vertical: "center" }
                                    };
                                }
                            });
                            
                            matrixData.push(typeRow);
                            currentRowIdx++;
                        });
                        
                        // Baris Total Jam (Bold & Rata Tengah)
                        const workHoursRow = new Array(datesList.length + 1).fill('');
                        workHoursRow[0] = 'Total Jam';

                        cellStylesMap[`${currentRowIdx}_0`] = {
                            font: { bold: true },
                            fill: { fgColor: { rgb: "F8F9FA" } },
                            alignment: { horizontal: "center", vertical: "center" }
                        };

                        datesList.forEach((d, dIdx) => {
                            const c = dIdx + 1;
                            const dayAbsen = userObj.absensi[d];
                            
                            let jamKerjaStr = '-';
                            if (dayAbsen) {
                                let minMasukMins = null;
                                let maxPulangMins = null;
                                let waktuIzinKeluar = null;
                                let waktuIzinMasuk = null;
                                let waktuIstirahatKeluarList = [];
                                let waktuIstirahatMasukList = [];

                                const parseTLast = (tStr) => {
                                    if (!tStr) return null;
                                    const parts = String(tStr).split(',');
                                    const lastTime = parts[parts.length - 1].trim();
                                    const p = lastTime.split(':');
                                    if (p.length < 2) return null;
                                    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
                                };

                                const formatM = (m) => {
                                    if (m <= 0) return '0j 0m';
                                    return `${Math.floor(m / 60)}j ${m % 60}m`;
                                };

                                tipeAbsenList.forEach(tipe => {
                                    const a = dayAbsen[tipe];
                                    if (a && a.waktu && a.waktu !== '-') {
                                        const tipeLower = tipe.toLowerCase();
                                        if (tipeLower.includes('izin keluar')) {
                                            waktuIzinKeluar = a.waktu;
                                        } else if (tipeLower.includes('izin masuk') || tipeLower.includes('izin kembali')) {
                                            waktuIzinMasuk = a.waktu;
                                        } else if (tipeLower.includes('istirahat')) {
                                            const times = String(a.waktu).split(',').map(t => t.trim());
                                            if (tipeLower.includes('keluar')) {
                                                times.forEach(t => {
                                                    const parsed = parseT(t);
                                                    if (parsed !== null) waktuIstirahatKeluarList.push(parsed);
                                                });
                                            } else if (tipeLower.includes('masuk') || tipeLower.includes('kembali')) {
                                                times.forEach(t => {
                                                    const parsed = parseT(t);
                                                    if (parsed !== null) waktuIstirahatMasukList.push(parsed);
                                                });
                                            }
                                        } else {
                                            let masterMatch = null;
                                            if (typeof globalMasterTipeAbsen !== 'undefined') {
                                                masterMatch = globalMasterTipeAbsen.find(t => t.nama_tipe === tipe);
                                            }
                                            const isCheckout = (masterMatch && masterMatch.is_checkout) || 
                                                              tipeLower.includes('pulang') || 
                                                              tipeLower.includes('checkout') || 
                                                              (tipeLower.includes('lembur') && (tipeLower.includes('keluar') || tipeLower.includes('selesai')));
                                            
                                            if (isCheckout) {
                                                const pMins = parseTLast(a.waktu);
                                                if (pMins !== null) {
                                                    if (maxPulangMins === null || pMins > maxPulangMins) {
                                                        maxPulangMins = pMins;
                                                    }
                                                }
                                            } else {
                                                const mMins = parseT(a.waktu);
                                                if (mMins !== null) {
                                                    if (minMasukMins === null || mMins < minMasukMins) {
                                                        minMasukMins = mMins;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                });

                                if (minMasukMins !== null && maxPulangMins !== null) {
                                    let diffMins = maxPulangMins - minMasukMins;
                                    if (diffMins < 0) diffMins += 1440; // Lintas tengah malam
                                    
                                    // Hitung total menit izin
                                    let izinMins = 0;
                                    if (waktuIzinKeluar && waktuIzinMasuk) {
                                        const kMins = parseT(waktuIzinKeluar);
                                        const mMinsIzin = parseT(waktuIzinMasuk);
                                        if (kMins && mMinsIzin && mMinsIzin > kMins) {
                                            izinMins = mMinsIzin - kMins;
                                        }
                                    }
                                    
                                    let totalKerjaMins = diffMins - izinMins;
                                    if (totalKerjaMins < 0) totalKerjaMins = 0;
                                    jamKerjaStr = formatM(totalKerjaMins);
                                }
                            }

                            workHoursRow[c] = jamKerjaStr;

                            cellStylesMap[`${currentRowIdx}_${c}`] = {
                                font: { bold: true },
                                fill: { fgColor: { rgb: "F8F9FA" } },
                                alignment: { horizontal: "center", vertical: "center" }
                            };
                        });

                        matrixData.push(workHoursRow);
                        currentRowIdx++;

                        // Baris Total Lembur (Bold & Rata Tengah)
                        const lemburRow = new Array(datesList.length + 1).fill('');
                        lemburRow[0] = 'Total Lembur';

                        cellStylesMap[`${currentRowIdx}_0`] = {
                            font: { bold: true },
                            fill: { fgColor: { rgb: "F8F9FA" } },
                            alignment: { horizontal: "center", vertical: "center" }
                        };

                        datesList.forEach((d, dIdx) => {
                            const c = dIdx + 1;
                            const dayAbsen = userObj.absensi[d];
                            
                            let totalLemburMin = 0;
                            if (dayAbsen) {
                                Object.keys(dayAbsen).forEach(tKey => {
                                    const aObj = dayAbsen[tKey];
                                    if (aObj && aObj.waktu && aObj.waktu !== '-') {
                                        if (aObj.menit_lembur > 0) {
                                            totalLemburMin = Math.max(totalLemburMin, aObj.menit_lembur);
                                        }
                                        if (aObj.keterangan_waktu && aObj.keterangan_waktu.toLowerCase().includes('lembur')) {
                                            const matchJ = aObj.keterangan_waktu.match(/(\d+)\s*j(?:am)?/i);
                                            const matchM = aObj.keterangan_waktu.match(/(\d+)\s*m(?:enit)?/i);
                                            if (matchJ || matchM) {
                                                const j = matchJ ? parseInt(matchJ[1], 10) : 0;
                                                const m = matchM ? parseInt(matchM[1], 10) : 0;
                                                totalLemburMin = Math.max(totalLemburMin, j * 60 + m);
                                            }
                                        }

                                        let limitMin = null;
                                        if (typeof globalMasterTipeAbsen !== 'undefined' && globalMasterTipeAbsen) {
                                            const mObj = globalMasterTipeAbsen.find(m => m.nama_tipe === tKey) || globalMasterTipeAbsen.find(m => m.is_checkout);
                                            if (mObj && (mObj.is_checkout || tKey.toLowerCase().includes('pulang') || tKey.toLowerCase().includes('checkout'))) {
                                                const endStr = mObj.batas_terlambat || (mObj.jam_tutup && mObj.jam_tutup !== '23:59:59' ? mObj.jam_tutup : null);
                                                if (endStr) limitMin = parseT(endStr);
                                            }
                                        }
                                        const wMin = parseT(aObj.waktu);
                                        if (limitMin !== null && wMin !== null && wMin > limitMin) {
                                            totalLemburMin = Math.max(totalLemburMin, wMin - limitMin);
                                        }
                                    }
                                });
                            }

                            lemburRow[c] = totalLemburMin > 0 ? `${Math.floor(totalLemburMin / 60)}j ${totalLemburMin % 60}m` : '-';

                            cellStylesMap[`${currentRowIdx}_${c}`] = {
                                font: { bold: true, color: { rgb: totalLemburMin > 0 ? "28A745" : "000000" } },
                                fill: { fgColor: { rgb: "F8F9FA" } },
                                alignment: { horizontal: "center", vertical: "center" }
                            };
                        });

                        matrixData.push(lemburRow);
                        currentRowIdx++;

                        // Baris Kosong Pemisah Karyawan
                        matrixData.push(new Array(datesList.length + 1).fill(''));
                        currentRowIdx++;
                    });

                    const ws = XLSX.utils.aoa_to_sheet(matrixData);

                    // Terapkan style ke sel worksheet & buatkan sel objek jika belum ada
                    for (let r = 0; r < matrixData.length; r++) {
                        for (let c = 0; c < matrixData[r].length; c++) {
                            const cellRef = XLSX.utils.encode_cell({ r, c });
                            if (!ws[cellRef]) {
                                ws[cellRef] = { t: 's', v: matrixData[r][c] || '' };
                            }
                            if (cellStylesMap[`${r}_${c}`]) {
                                ws[cellRef].s = cellStylesMap[`${r}_${c}`];
                            }
                        }
                    }

                    // Auto-fit Ukuran Kolom (A1:An menyesuaikan isi teks agar tidak terpotong)
                    const colWidths = new Array(datesList.length + 1).fill(0);
                    matrixData.forEach(row => {
                        row.forEach((val, colIdx) => {
                            const strVal = val !== null && val !== undefined ? String(val) : '';
                            if (strVal.length > colWidths[colIdx]) {
                                colWidths[colIdx] = strVal.length;
                            }
                        });
                    });

                    ws['!cols'] = colWidths.map((len, colIdx) => {
                        if (colIdx === 0) {
                            return { wch: Math.max(len + 4, 20) };
                        }
                        return { wch: Math.max(len + 3, 8) };
                    });

                    // Freeze Header Tanggal (Baris 1) & Freeze Kolom A (Tipe Absen / Nama) saat di-scroll
                    ws['!freeze'] = { xSplit: 1, ySplit: 1, topLeftCell: 'B2', activePane: 'bottomRight', state: 'frozen' };
                    ws['!views'] = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2', activePane: 'bottomRight' }];

                    // Nama Sheet yang aman untuk Excel
                    let safeSheetName = (cabangName || 'Tanpa Cabang')
                        .replace(/[:\\/?*\[\]]/g, '')
                        .trim()
                        .substring(0, 31) || 'Sheet1';
                    
                    let sheetName = safeSheetName;
                    let counter = 1;
                    while (usedSheetNames.has(sheetName)) {
                        sheetName = `${safeSheetName.substring(0, 28)}_${counter++}`;
                    }
                    usedSheetNames.add(sheetName);

                    XLSX.utils.book_append_sheet(wb, ws, sheetName);
                });
            }

            // Tambahkan Sheet: Info Tipe Absen
            try {
                const { data: listTipe } = await supabaseClient.from('master_tipe_absen').select('*').order('id', { ascending: true });
                if (listTipe && listTipe.length > 0) {
                    const tipeData = [];
                    tipeData.push(['No', 'Nama Tipe Absen', 'Jam Mulai', 'Jam Tutup', 'Batas Terlambat', 'Jenis / Keterangan']);
                    
                    const tipeStyles = {};
                    for (let c = 0; c < 6; c++) {
                        tipeStyles[`0_${c}`] = {
                            font: { bold: true },
                            fill: { fgColor: { rgb: "E9ECEF" } },
                            alignment: { horizontal: "center", vertical: "center" }
                        };
                    }
                    
                    listTipe.forEach((t, idx) => {
                        const r = idx + 1;
                        const no = idx + 1;
                        const nama = t.nama_tipe || '-';
                        const jMulai = t.jam_mulai ? formatWaktuGlobal(t.jam_mulai) : '-';
                        const jTutup = t.jam_tutup ? formatWaktuGlobal(t.jam_tutup) : '-';
                        const jTerlambat = t.batas_terlambat ? formatWaktuGlobal(t.batas_terlambat) : '-';
                        const ket = t.is_checkout ? 'Pulang / Checkout' : 'Masuk / Checkin';
                        
                        tipeData.push([no, nama, jMulai, jTutup, jTerlambat, ket]);
                        
                        tipeStyles[`${r}_0`] = { alignment: { horizontal: "center", vertical: "center" } };
                        tipeStyles[`${r}_1`] = { alignment: { horizontal: "left", vertical: "center" } };
                        tipeStyles[`${r}_2`] = { alignment: { horizontal: "center", vertical: "center" } };
                        tipeStyles[`${r}_3`] = { alignment: { horizontal: "center", vertical: "center" } };
                        tipeStyles[`${r}_4`] = { alignment: { horizontal: "center", vertical: "center" } };
                        tipeStyles[`${r}_5`] = { alignment: { horizontal: "center", vertical: "center" } };
                    });
                    
                    const wsTipe = XLSX.utils.aoa_to_sheet(tipeData);
                    for (let r = 0; r < tipeData.length; r++) {
                        for (let c = 0; c < tipeData[r].length; c++) {
                            const cellRef = XLSX.utils.encode_cell({ r, c });
                            if (!wsTipe[cellRef]) wsTipe[cellRef] = { t: 's', v: tipeData[r][c] || '' };
                            if (tipeStyles[`${r}_${c}`]) wsTipe[cellRef].s = tipeStyles[`${r}_${c}`];
                        }
                    }
                    
                    const colWidthsTipe = new Array(6).fill(0);
                    tipeData.forEach(row => {
                        row.forEach((val, cIdx) => {
                            const len = val !== null && val !== undefined ? String(val).length : 0;
                            if (len > colWidthsTipe[cIdx]) colWidthsTipe[cIdx] = len;
                        });
                    });
                    wsTipe['!cols'] = colWidthsTipe.map((len, cIdx) => ({ wch: Math.max(len + 4, 14) }));
                    
                    XLSX.utils.book_append_sheet(wb, wsTipe, "Info Tipe Absen");
                }
            } catch(e) {
                console.error("Gagal menambahkan Sheet Info Tipe Absen:", e);
            }

            // Tambahkan Sheet: Data Karyawan
            try {
                let qUserExport = supabaseClient.from('users').select('*').order('cabang', { ascending: true }).order('nama', { ascending: true });
                if (!isSuperAdmin) {
                    qUserExport = qUserExport.eq('cabang', myCabang);
                }
                const { data: listUserExport } = await qUserExport;
                if (listUserExport && listUserExport.length > 0) {
                    const userDataExport = [];
                    userDataExport.push(['No', 'Nama Karyawan', 'Kantor / Cabang', 'Unit', 'Role / Akses']);
                    
                    const userStyles = {};
                    for (let c = 0; c < 5; c++) {
                        userStyles[`0_${c}`] = {
                            font: { bold: true },
                            fill: { fgColor: { rgb: "E9ECEF" } },
                            alignment: { horizontal: "center", vertical: "center" }
                        };
                    }
                    
                    listUserExport.forEach((u, idx) => {
                        const r = idx + 1;
                        const no = idx + 1;
                        const nama = u.nama || '-';
                        const cabang = u.cabang || '-';
                        const unitVal = u.unit || '-';
                        const role = u.role || 'Karyawan';
                        
                        userDataExport.push([no, nama, cabang, unitVal, role]);
                        
                        userStyles[`${r}_0`] = { alignment: { horizontal: "center", vertical: "center" } };
                        userStyles[`${r}_1`] = { alignment: { horizontal: "left", vertical: "center" } };
                        userStyles[`${r}_2`] = { alignment: { horizontal: "center", vertical: "center" } };
                        userStyles[`${r}_3`] = { alignment: { horizontal: "center", vertical: "center" } };
                        userStyles[`${r}_4`] = { alignment: { horizontal: "center", vertical: "center" } };
                    });
                    
                    const wsUser = XLSX.utils.aoa_to_sheet(userDataExport);
                    for (let r = 0; r < userDataExport.length; r++) {
                        for (let c = 0; c < userDataExport[r].length; c++) {
                            const cellRef = XLSX.utils.encode_cell({ r, c });
                            if (!wsUser[cellRef]) wsUser[cellRef] = { t: 's', v: userDataExport[r][c] || '' };
                            if (userStyles[`${r}_${c}`]) wsUser[cellRef].s = userStyles[`${r}_${c}`];
                        }
                    }
                    
                    const colWidthsUser = new Array(5).fill(0);
                    userDataExport.forEach(row => {
                        row.forEach((val, cIdx) => {
                            const len = val !== null && val !== undefined ? String(val).length : 0;
                            if (len > colWidthsUser[cIdx]) colWidthsUser[cIdx] = len;
                        });
                    });
                    wsUser['!cols'] = colWidthsUser.map((len, cIdx) => ({ wch: Math.max(len + 4, 16) }));
                    
                    XLSX.utils.book_append_sheet(wb, wsUser, "Data Karyawan");
                }
            } catch(e) {
                console.error("Gagal menambahkan Sheet Data Karyawan:", e);
            }

            const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const excelBlob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            rootFolder.file("rekap_absen.xlsx", excelBlob);
        } else {
            // Fallback CSV jika SheetJS tidak tersedia
            const sortedCabangs = Object.keys(branchMap).sort();
            let allCsv = "";
            sortedCabangs.forEach(cabangName => {
                allCsv += `--- CABANG: ${cabangName} ---\n`;
                const userGroupMap = branchMap[cabangName];
                const matrixData = [];
                const headerRow = [''];
                datesList.forEach(d => headerRow.push(parseInt(d.split('-')[2], 10)));
                matrixData.push(headerRow);

                const userNames = Object.keys(userGroupMap).sort();
                userNames.forEach(namaUser => {
                    const userObj = userGroupMap[namaUser];
                    const nameRow = new Array(datesList.length + 1).fill('');
                    nameRow[0] = userObj.nama;
                    matrixData.push(nameRow);
                    tipeAbsenList.forEach(tipe => {
                        const typeRow = new Array(datesList.length + 1).fill('');
                        typeRow[0] = tipe;
                        datesList.forEach((d, dIdx) => {
                            const dayAbsen = userObj.absensi[d];
                            if (dayAbsen && dayAbsen[tipe] && dayAbsen[tipe].waktu) {
                                typeRow[dIdx + 1] = dayAbsen[tipe].waktu;
                            }
                        });
                        matrixData.push(typeRow);
                    });
                    matrixData.push(new Array(datesList.length + 1).fill(''));
                });

                let csvMatrix = matrixData.map(row => row.map(cell => {
                    if (cell === null || cell === undefined) return '""';
                    const str = String(cell);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                }).join(',')).join('\n');
                allCsv += csvMatrix + "\n\n";
            });
            rootFolder.file("rekap_absen.csv", allCsv);
        }

        // 4. Proses Foto jika dicentang
        if (isMedia) {
            const mediaFolder = rootFolder.folder("media");
            const simpanFoto = async (url, folder, namaFile) => {
                if (url && url.startsWith('http')) {
                    try {
                        const response = await fetch(url);
                        if (response.ok) {
                            const blob = await response.blob();
                            folder.file(namaFile, blob);
                        }
                    } catch (err) {
                        console.error("Gagal mendownload foto:", url, err);
                    }
                }
            };

            const sortedCabangs = Object.keys(branchMap).sort();
            for (const cabangName of sortedCabangs) {
                const userGroupMap = branchMap[cabangName];
                const userNames = Object.keys(userGroupMap).sort();
                for (const namaUser of userNames) {
                    const userObj = userGroupMap[namaUser];
                    const userFolder = mediaFolder.folder(userObj.nama);
                    
                    for (const d of datesList) {
                        const dayAbsen = userObj.absensi[d];
                        if (dayAbsen) {
                            for (const tipe of tipeAbsenList) {
                                const a = dayAbsen[tipe];
                                if (a && a.foto) {
                                    const cleanTipe = tipe.replace(/ /g, '_');
                                    await simpanFoto(a.foto, userFolder, `${d}_${cleanTipe}.png`);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 4. AMBIL DATA CUTI / IZIN
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
        if (row.foto) files.push(extractFilename(row.foto));
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
            
            const elFormat = document.getElementById('setting_format_waktu');
            if (elFormat) elFormat.value = data.format_waktu || 'HH:mm:ss';
            window.currentFormatWaktu = data.format_waktu || 'HH:mm:ss';
            
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

function formatWaktuGlobal(timeStr) {
    if (!timeStr || timeStr === '-') return '-';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const format = window.currentFormatWaktu || 'HH:mm:ss';
    if (format === 'HH:mm') {
        return `${parts[0]}:${parts[1]}`;
    }
    return timeStr.length === 5 ? `${timeStr}:00` : timeStr;
}
window.formatWaktuGlobal = formatWaktuGlobal;

async function saveSettings() {
    const nama_aplikasi = document.getElementById('setting_nama_aplikasi').value;
    const login_subteks = document.getElementById('setting_login_subteks').value;
    const form_judul = document.getElementById('setting_form_judul').value;
    const pengumuman = document.getElementById('setting_pengumuman').value;
    const pengumuman_warna = document.getElementById('setting_pengumuman_warna').value;
    const enable_lokasi = document.getElementById('setting_enable_lokasi').checked;
    const enable_kamera = document.getElementById('setting_enable_kamera').checked;
    const format_waktu = document.getElementById('setting_format_waktu')?.value || 'HH:mm:ss';
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

        const payload = { id: 1, nama_aplikasi, login_subteks, form_judul, logo_url, pengumuman, pengumuman_warna, enable_lokasi, enable_kamera, format_waktu };
        
        let { error } = await supabaseClient.from('app_settings').upsert(payload, { onConflict: 'id' });
        
        if (error && (error.code === 'PGRST204' || (error.message && error.message.includes('format_waktu')))) {
            console.warn("Kolom format_waktu belum ada di Supabase Cloud app_settings table. Fallback simpan tanpa format_waktu...");
            const fallbackPayload = { id: 1, nama_aplikasi, login_subteks, form_judul, logo_url, pengumuman, pengumuman_warna, enable_lokasi, enable_kamera };
            const { error: fallbackErr } = await supabaseClient.from('app_settings').upsert(fallbackPayload, { onConflict: 'id' });
            
            if (!fallbackErr) {
                window.currentFormatWaktu = format_waktu;
                if (typeof renderTipeAbsen === 'function') renderTipeAbsen();
                Swal.fire({
                    title: 'Pengaturan Disimpan',
                    html: `Pengaturan utama berhasil disimpan.<br><br><small class="text-warning"><strong>⚠️ Catatan Tambahan:</strong> Database Supabase Cloud Anda belum memiliki kolom <code>format_waktu</code>.<br><br>Silakan jalankan perintah SQL berikut di <strong>Supabase Dashboard (SQL Editor)</strong>:<br><code class="bg-dark text-white p-2 rounded d-block mt-2 text-start">ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS format_waktu TEXT DEFAULT 'HH:mm:ss';</code></small>`,
                    icon: 'warning'
                });
                return;
            }
        }

        if (error) throw error;
        
        window.currentFormatWaktu = format_waktu;
        if (typeof renderTipeAbsen === 'function') renderTipeAbsen();
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

            // Penanganan hari_libur
            if (hari_libur === "-" || (hari_libur || "").toLowerCase() === "kosong") {
                hari_libur = ""; // Tidak ada hari libur
            } else if (!hari_libur) {
                hari_libur = "0,6"; // Default jika benar-benar tidak diisi
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
                hari_libur: hari_libur,
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
    
    Swal.fire({
        title: includeMedia ? 'Membackup Database Enterprise & Media...' : 'Membackup Database Enterprise...',
        html: 'Mengumpulkan seluruh data master (kantor, karyawan, tipe absen, jenis cuti, form config) & transaksi absensi/cuti...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        // List seluruh tabel resmi database Zieda Absen
        const targetTables = [
            'users',
            'kantor',
            'master_tipe_absen',
            'master_jenis_cuti',
            'form_cuti_config',
            'app_settings',
            'absensi',
            'cuti'
        ];

        const dbTablesData = {};
        const tablesSummary = {};
        let totalRecordsCount = 0;

        for (const table of targetTables) {
            try {
                const { data, error } = await supabaseClient.from(table).select('*');
                if (error) console.warn(`Supabase error for table ${table}:`, error);
                const records = data || [];
                dbTablesData[table] = records;
                tablesSummary[table] = records.length;
                totalRecordsCount += records.length;
            } catch (e) {
                console.warn(`Gagal mengambil data tabel ${table}:`, e);
                dbTablesData[table] = [];
                tablesSummary[table] = 0;
            }
        }

        // Format Standar Profesional Enterprise
        const enterpriseBackupObj = {
            system_info: {
                app_name: "Zieda Absen Enterprise System",
                schema_version: "3.5",
                export_timestamp: new Date().toISOString(),
                environment: typeof ACTIVE_ENVIRONMENT !== 'undefined' ? ACTIVE_ENVIRONMENT : 'UNKNOWN',
                total_records: totalRecordsCount
            },
            tables_summary: tablesSummary,
            database: dbTablesData
        };

        const json = JSON.stringify(enterpriseBackupObj, null, 2);
        const d = new Date();
        const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
        
        if (includeMedia) {
            const zip = new JSZip();
            const mediaFolder = zip.folder("media");
            
            const mediaTasks = [];
            const processedPaths = new Set();

            const addUrlToBackup = (rawUrl) => {
                if (!rawUrl || typeof rawUrl !== 'string') return;

                const bucketMarker = '/absensi-bucket/';
                const idx = rawUrl.indexOf(bucketMarker);
                
                if (idx !== -1) {
                    const storagePath = rawUrl.substring(idx + bucketMarker.length).replace(/^\/+/, '');
                    if (!storagePath || processedPaths.has(storagePath)) return;
                    processedPaths.add(storagePath);

                    mediaTasks.push(async () => {
                        try {
                            // 1. Coba download via Supabase Storage Client (Bypasses CORS/Domain issues)
                            const { data: blob, error: dlErr } = await supabaseClient.storage.from('absensi-bucket').download(storagePath);
                            if (!dlErr && blob) {
                                mediaFolder.file(storagePath, blob);
                                return;
                            }
                        } catch (e) {}

                        try {
                            // 2. Fallback via HTTP fetch menggunakan fixStorageUrl
                            const targetUrl = typeof fixStorageUrl === 'function' ? fixStorageUrl(rawUrl) : rawUrl;
                            const res = await fetch(targetUrl);
                            if (res.ok) {
                                const blob = await res.blob();
                                mediaFolder.file(storagePath, blob);
                            }
                        } catch (e) {
                            console.warn("Gagal mendownload foto backup:", storagePath, e);
                        }
                    });
                } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
                    const fileName = rawUrl.split('?')[0].split('/').pop() || `media_${Date.now()}.png`;
                    const storagePath = `external/${fileName}`;
                    if (processedPaths.has(storagePath)) return;
                    processedPaths.add(storagePath);

                    mediaTasks.push(async () => {
                        try {
                            const res = await fetch(rawUrl);
                            if (res.ok) {
                                const blob = await res.blob();
                                mediaFolder.file(storagePath, blob);
                            }
                        } catch (e) {}
                    });
                }
            };

            // 1. Kumpulkan media dari tabel ABSENSI
            for (const a of dbTablesData['absensi'] || []) {
                addUrlToBackup(a.foto);
                addUrlToBackup(a.foto_masuk);
                addUrlToBackup(a.foto_keluar);
                addUrlToBackup(a.foto_istirahat_keluar);
                addUrlToBackup(a.foto_istirahat_masuk);
            }

            // 2. Kumpulkan media dari tabel USERS (foto_wajah)
            for (const u of dbTablesData['users'] || []) {
                addUrlToBackup(u.foto_wajah);
            }

            // 3. Kumpulkan media dari tabel APP_SETTINGS (logo_url)
            for (const s of dbTablesData['app_settings'] || []) {
                addUrlToBackup(s.logo_url);
            }

            // 4. Kumpulkan media dari tabel CUTI (lampiran data_tambahan)
            for (const c of dbTablesData['cuti'] || []) {
                if (c.data_tambahan && typeof c.data_tambahan === 'object') {
                    for (const val of Object.values(c.data_tambahan)) {
                        if (typeof val === 'string') {
                            addUrlToBackup(val);
                        }
                    }
                }
            }

            // Eksekusi pencapaian unduhan media secara paralel (batch 10)
            let completed = 0;
            const batchSize = 10;
            for (let i = 0; i < mediaTasks.length; i += batchSize) {
                const batch = mediaTasks.slice(i, i + batchSize);
                await Promise.all(batch.map(task => task()));
                completed += batch.length;
                Swal.update({ html: `Mendownload foto & media... (${Math.min(completed, mediaTasks.length)} / ${mediaTasks.length})` });
            }

            zip.file("database_backup.json", json);
            Swal.update({ html: `Membuat paket ZIP Enterprise...` });
            const zipContent = await zip.generateAsync({ type: "blob" });
            saveAs(zipContent, `Backup_Enterprise_Absensi_${dateStr}.zip`);
            
        } else {
            const blob = new Blob([json], { type: 'application/json' });
            saveAs(blob, `Backup_Enterprise_Absensi_${dateStr}.json`);
        }
        
        Swal.fire("Berhasil", `Backup Enterprise berhasil diunduh! (${totalRecordsCount} data record tersimpan)`, "success");
    } catch(err) {
        Swal.fire("Error", "Gagal membackup database: " + err.message, "error");
    }
}

async function restoreDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const isZip = file.name.endsWith('.zip');
    
    const result = await Swal.fire({
        title: "Peringatan Pemulihan Data!",
        text: isZip 
            ? "Restore file ZIP akan mengunggah ulang seluruh foto & memulihkan database ke server aktif ini. Lanjutkan?"
            : "Restore file JSON akan memulihkan data & menyesuaikan seluruh link gambar dari server lama ke server aktif. Lanjutkan?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Ya, Mulai Restore Data!"
    });
    
    if (!result.isConfirmed) {
        event.target.value = '';
        return;
    }
    
    Swal.fire({ title: 'Memulihkan Database...', html: 'Menguraikan paket backup & menyiapkan data...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        let jsonString = '';
        let mediaFiles = {};

        if (isZip) {
            const zip = await JSZip.loadAsync(file);
            const backupJsonFile = zip.file("database_backup.json");
            if (!backupJsonFile) {
                throw new Error("File 'database_backup.json' tidak ditemukan di dalam paket ZIP!");
            }
            jsonString = await backupJsonFile.async("text");
            
            // Kumpulkan file media dari folder media/ di ZIP
            const relativePaths = Object.keys(zip.files).filter(p => p.startsWith("media/") && !zip.files[p].dir);
            for (const path of relativePaths) {
                const blob = await zip.file(path).async("blob");
                const targetBucketPath = path.replace(/^media\//, '');
                mediaFiles[targetBucketPath] = blob;
            }
        } else {
            jsonString = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (err) => reject(err);
                reader.readAsText(file);
            });
        }

        const parsed = JSON.parse(jsonString);
        const rawDb = parsed.database ? parsed.database : parsed;
        
        // ------------------------------------------
        // Normalisasi & Sanitasi Khusus Tabel 'kantor'
        // ------------------------------------------
        let kantorRecords = rawDb['kantor'] || rawDb['cabang'] || [];

        // Jika data kantorRecords kosong di file backup, ekstrak otomatis dari users.cabang agar tidak ada cabang yang hilang
        if (!Array.isArray(kantorRecords) || kantorRecords.length === 0) {
            const cabangNames = new Set(['Pusat']);
            if (Array.isArray(rawDb['users'])) {
                rawDb['users'].forEach(u => {
                    if (u.cabang && typeof u.cabang === 'string' && u.cabang.trim() !== '') {
                        cabangNames.add(u.cabang.trim());
                    }
                });
            }
            kantorRecords = Array.from(cabangNames).map((nama, idx) => ({
                id: idx + 1,
                nama: nama,
                lat: '-6.2088',
                lng: '106.8456',
                radius: 100
            }));
        }

        // Format ulang setiap record kantor agar persis cocok dengan skema tabel Supabase 'kantor'
        rawDb['kantor'] = kantorRecords.map((item, idx) => {
            if (typeof item === 'string') {
                return {
                    id: idx + 1,
                    nama: item,
                    lat: '-6.2088',
                    lng: '106.8456',
                    radius: 100,
                    created_at: new Date().toISOString()
                };
            }
            return {
                id: parseInt(item.id || (idx + 1), 10),
                nama: String(item.nama || item.nama_kantor || item.nama_cabang || item.cabang || `Kantor ${idx + 1}`),
                lat: String(item.lat || item.latitude || '-6.2088'),
                lng: String(item.lng || item.longitude || '106.8456'),
                radius: parseInt(item.radius || item.radius_meter || 100, 10),
                created_at: item.created_at || new Date().toISOString()
            };
        });

        // 1. Jika ada media dari paket ZIP, unggah ulang ke storage bucket server baru secara otomatis
        const mediaKeys = Object.keys(mediaFiles);
        if (mediaKeys.length > 0) {
            let uploadedMediaCount = 0;
            for (const bucketPath of mediaKeys) {
                try {
                    const blob = mediaFiles[bucketPath];
                    await supabaseClient.storage.from('absensi-bucket').upload(bucketPath, blob, { upsert: true });
                    uploadedMediaCount++;
                    Swal.update({ html: `Mengunggah foto & media ke server baru... (${uploadedMediaCount} / ${mediaKeys.length})` });
                } catch (e) {
                    console.warn("Gagal re-upload media:", bucketPath, e);
                }
            }
        }

        // 2. Auto Rewriter: Normalisasi seluruh URL Gambar di database agar menunjuk ke SUPABASE_URL server aktif
        const normalizeUrl = (url) => {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:')) return url;
            const idx = url.indexOf('/absensi-bucket/');
            if (idx !== -1) {
                const pathAfterBucket = url.substring(idx + '/absensi-bucket/'.length);
                return `${SUPABASE_URL}/storage/v1/object/public/absensi-bucket/${pathAfterBucket}`;
            }
            return url;
        };

        if (Array.isArray(rawDb['users'])) {
            rawDb['users'].forEach(u => {
                if (u.foto_wajah) u.foto_wajah = normalizeUrl(u.foto_wajah);
            });
        }
        if (Array.isArray(rawDb['app_settings'])) {
            rawDb['app_settings'].forEach(s => {
                if (s.logo_url) s.logo_url = normalizeUrl(s.logo_url);
            });
        }
        if (Array.isArray(rawDb['absensi'])) {
            rawDb['absensi'].forEach(a => {
                if (a.foto) a.foto = normalizeUrl(a.foto);
                if (a.foto_masuk) a.foto_masuk = normalizeUrl(a.foto_masuk);
                if (a.foto_keluar) a.foto_keluar = normalizeUrl(a.foto_keluar);
                if (a.foto_istirahat_keluar) a.foto_istirahat_keluar = normalizeUrl(a.foto_istirahat_keluar);
                if (a.foto_istirahat_masuk) a.foto_istirahat_masuk = normalizeUrl(a.foto_istirahat_masuk);
            });
        }
        if (Array.isArray(rawDb['cuti'])) {
            rawDb['cuti'].forEach(c => {
                if (c.data_tambahan && typeof c.data_tambahan === 'object') {
                    for (const k in c.data_tambahan) {
                        if (typeof c.data_tambahan[k] === 'string') {
                            c.data_tambahan[k] = normalizeUrl(c.data_tambahan[k]);
                        }
                    }
                }
            });
        }

        // 3. Masukkan data ke database baru sesuai urutan relasi
        const restoreSequence = [
            'kantor',
            'master_tipe_absen',
            'master_jenis_cuti',
            'form_cuti_config',
            'app_settings',
            'users',
            'cuti',
            'absensi'
        ];

        let restoredCount = 0;
        const failedTables = [];

        for (const table of restoreSequence) {
            const records = rawDb[table];
            if (records && Array.isArray(records) && records.length > 0) {
                const { error } = await supabaseClient.from(table).upsert(records, { onConflict: 'id' });
                if (error) {
                    console.warn(`Upsert massal gagal untuk tabel ${table}, mencoba per-baris:`, error);
                    let tableRestored = 0;
                    for (const row of records) {
                        const { error: singleErr } = await supabaseClient.from(table).upsert(row, { onConflict: 'id' });
                        if (!singleErr) tableRestored++;
                        else console.warn(`Gagal upsert row tabel ${table}:`, singleErr, row);
                    }
                    if (tableRestored > 0) {
                        restoredCount += tableRestored;
                    } else {
                        failedTables.push(table);
                    }
                } else {
                    restoredCount += records.length;
                }
            }
        }
        
        let msgSuccess = `Database berhasil dipulihkan & seluruh link foto otomatis ditautkan ke server baru! (${restoredCount} record diproses)`;
        if (failedTables.length > 0) {
            msgSuccess += `<br><small class="text-warning">Catatan: Tabel (${failedTables.join(', ')}) gagal dipulihkan sebagian/seluruhnya.</small>`;
        }

        Swal.fire("Berhasil", msgSuccess, "success").then(() => {
            location.reload();
        });

    } catch(err) {
        Swal.fire("Error", "Gagal memulihkan data: " + err.message, "error");
    } finally {
        event.target.value = '';
    }
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
            absenData.foto,
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
    
    // INSTANT OPTIMISTIC DOM RE-RENDER:
    if (allAbsensiGrouped && tanggal && allAbsensiGrouped[tanggal] && allAbsensiGrouped[tanggal].records) {
        allAbsensiGrouped[tanggal].records = allAbsensiGrouped[tanggal].records.filter(r => String(r.id) !== String(absenId));
        if (currentAbsensiTanggal === tanggal) {
            showDetailAbsensi(tanggal, currentAbsensiDateStr);
        }
    }

    Swal.fire({ title: "Berhasil", text: "Data absen beserta foto berhasil dihapus.", icon: "success", timer: 1200, showConfirmButton: false });
    loadDataAbsensi(false);
}

// Helper untuk memastikan Sesi Otentikasi JWT Supabase Aktif sebelum operasi admin krusial
async function ensureAuthenticatedSession() {
    try {
        let { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            return session;
        }

        // 1. Coba refresh sesi JWT jika sudah pernah ada
        const { data: refreshData } = await supabaseClient.auth.refreshSession();
        if (refreshData?.session) {
            return refreshData.session;
        }

        // 2. Jika tidak ada sesi, coba auto-login menggunakan kredensial pengguna yang sedang aktif
        if (currentUser && currentUser.nama && currentUser.password) {
            const activeEmail = `${currentUser.nama.replace(/\s+/g, "").toLowerCase()}@zieabsen.com`;
            let authResult = await supabaseClient.auth.signInWithPassword({
                email: activeEmail,
                password: currentUser.password
            });

            if (authResult?.error) {
                // Jika akun Auth Supabase belum dibuat, daftarkan
                await supabaseClient.auth.signUp({
                    email: activeEmail,
                    password: currentUser.password
                });
                authResult = await supabaseClient.auth.signInWithPassword({
                    email: activeEmail,
                    password: currentUser.password
                });
            }

            if (authResult?.data?.session) {
                const newSession = authResult.data.session;
                if (currentUser.id) {
                    await supabaseClient.from('users').update({ auth_id: newSession.user.id }).eq('id', currentUser.id);
                }
                return newSession;
            }
        }
    } catch (e) {
        console.warn("[ensureAuthenticatedSession] Supabase Auth engine (/auth/v1) tidak merespon/terisolasi. Menggunakan sesi fallback database:", e);
    }

    // Fallback: Jika Auth engine (/auth/v1) di ngrok tidak di-tunnel atau tidak aktif, izinkan operasi berbasis sesi lokal Super Admin
    if (currentUser && currentUser.role === 'Super Admin' && currentUser.id) {
        return { user: { id: currentUser.id }, isFallback: true };
    }

    return null;
}

// ==========================================
// FACTORY RESET
// ==========================================
async function factoryResetDatabase() {
    if (!isSuperAdmin) {
        Swal.fire("Akses Ditolak", "Hanya Super Admin yang dapat melakukan Factory Reset.", "error");
        return;
    }

    if (!currentUser || !currentUser.id) {
        Swal.fire("Sesi Tidak Valid", "Data profil pengguna tidak ditemukan. Silakan logout dan login kembali.", "error");
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
        // 0. Pastikan Sesi Auth Supabase Aktif (Mencegah Error 401 Unauthorized / RLS Blocked)
        const activeSession = await ensureAuthenticatedSession();
        if (!activeSession) {
            throw new Error("Sesi otentikasi Supabase tidak aktif atau kadaluarsa (401 Unauthorized). Silakan logout dan login kembali sebagai Super Admin.");
        }

        // 1. Hapus isi tabel
        const tablesToClear = ['absensi', 'cuti', 'form_cuti_config', 'kantor', 'master_jenis_cuti', 'master_tipe_absen'];
        
        for (const table of tablesToClear) {
            const { data, error: selectErr } = await supabaseClient.from(table).select('*');
            if (selectErr) {
                console.warn(`[Factory Reset] Warning select ${table}:`, selectErr.message);
            }
            if (data && data.length > 0) {
                let deleteCol = data[0].id !== undefined ? 'id' : (data[0].nama !== undefined ? 'nama' : Object.keys(data[0])[0]);
                const { error: delErr } = await supabaseClient.from(table).delete().not(deleteCol, 'is', null);
                if (delErr) {
                    console.error(`[Factory Reset] Gagal menghapus tabel ${table}:`, delErr);
                    throw new Error(`Gagal menghapus data tabel ${table}: ${delErr.message}`);
                }
            }
        }

        // Hapus semua users KECUALI super admin yang sedang login
        const { error: delUsersErr } = await supabaseClient.from('users').delete().neq('id', currentUser.id);
        if (delUsersErr) {
            console.error("[Factory Reset] Gagal mereset tabel users:", delUsersErr);
            throw new Error(`Gagal mereset data pengguna: ${delUsersErr.message}`);
        }

        // 2. Inisialisasi Ulang Data Starter Template
        // A. Kantor
        const { error: errKantor } = await supabaseClient.from('kantor').insert([
            { nama: 'Zieda Pusat', lat: '-6.917464', lng: '107.619122', radius: 100 },
            { nama: 'Zieda Cabang Barat', lat: '-6.914000', lng: '107.600000', radius: 100 },
            { nama: 'Zieda Cabang Timur', lat: '-6.920000', lng: '107.630000', radius: 100 }
        ]);
        if (errKantor) {
            console.error("[Factory Reset] Gagal insert kantor:", errKantor);
            throw new Error(`Gagal inisialisasi starter data kantor: ${errKantor.message}`);
        }

        // B. Master Tipe Absen
        const { error: errTipe } = await supabaseClient.from('master_tipe_absen').insert([
            { nama_tipe: 'Absen Masuk Pagi', jam_mulai: '07:00:00', batas_terlambat: '08:00:00', jam_tutup: '16:00:00', is_checkout: false, is_aktif: true },
            { nama_tipe: 'Absen Pulang Pagi', jam_mulai: '15:00:00', batas_terlambat: '16:00:00', jam_tutup: '23:59:59', is_checkout: true, is_aktif: true },
            { nama_tipe: 'Absen Masuk Siang', jam_mulai: '12:00:00', batas_terlambat: '13:00:00', jam_tutup: '21:00:00', is_checkout: false, is_aktif: true },
            { nama_tipe: 'Absen Pulang Siang', jam_mulai: '20:00:00', batas_terlambat: '21:00:00', jam_tutup: '23:59:59', is_checkout: true, is_aktif: true },
            { nama_tipe: 'Istirahat Keluar', jam_mulai: '00:00:00', batas_terlambat: null, jam_tutup: null, is_checkout: false, is_aktif: true },
            { nama_tipe: 'Istirahat Masuk', jam_mulai: '00:00:00', batas_terlambat: null, jam_tutup: null, is_checkout: false, is_aktif: true },
            { nama_tipe: 'Izin Keluar', jam_mulai: '00:00:00', batas_terlambat: null, jam_tutup: null, is_checkout: false, is_aktif: true },
            { nama_tipe: 'Izin Masuk', jam_mulai: '00:00:00', batas_terlambat: null, jam_tutup: null, is_checkout: false, is_aktif: true }
        ]);
        if (errTipe) {
            console.error("[Factory Reset] Gagal insert master_tipe_absen:", errTipe);
            throw new Error(`Gagal inisialisasi master tipe absen: ${errTipe.message}`);
        }

        // C. Karyawan Test
        const { data: insertedUsers, error: errUsers } = await supabaseClient.from('users').insert([
            { nama: 'Budi Pagi', password: '123456', role: 'Karyawan', no_hp: '081234567891', cabang: 'Zieda Pusat', unit: 'Operasional', sisa_cuti: 12 },
            { nama: 'Siti Siang', password: '123456', role: 'Karyawan', no_hp: '081234567892', cabang: 'Zieda Pusat', unit: 'Kasir', sisa_cuti: 12 },
            { nama: 'Rudi Istirahat', password: '123456', role: 'Karyawan', no_hp: '081234567893', cabang: 'Zieda Pusat', unit: 'Gudang', sisa_cuti: 12 },
            { nama: 'Dewi Lembur', password: '123456', role: 'Karyawan', no_hp: '081234567894', cabang: 'Zieda Pusat', unit: 'HRD', sisa_cuti: 12 }
        ]).select();

        if (errUsers) {
            console.error("[Factory Reset] Gagal insert users:", errUsers);
            throw new Error(`Gagal inisialisasi starter pengguna/karyawan: ${errUsers.message}`);
        }

        // D. Demo Absensi Hari Ini
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const todayStr = new Date(now - offset).toISOString().split('T')[0];

        if (insertedUsers && insertedUsers.length > 0) {
            const budi = insertedUsers.find(u => u.nama === 'Budi Pagi');
            const siti = insertedUsers.find(u => u.nama === 'Siti Siang');
            const rudi = insertedUsers.find(u => u.nama === 'Rudi Istirahat');
            const dewi = insertedUsers.find(u => u.nama === 'Dewi Lembur');

            let sampleAbsen = [];
            if (budi) {
                sampleAbsen.push(
                    { user_id: budi.id, tanggal: todayStr, waktu: '08:25:00', tipe_absen: 'Absen Masuk Pagi', lokasi: 'Jarak: 5m dari Zieda Pusat', status: 'Terlambat', status_wajah: 'Sesuai', menit_terlambat: 25, menit_lembur: 0, keterangan_waktu: 'Terlambat 25m' },
                    { user_id: budi.id, tanggal: todayStr, waktu: '16:02:00', tipe_absen: 'Absen Pulang Pagi', lokasi: 'Jarak: 4m dari Zieda Pusat', status: 'Hadir', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Pulang Normal' }
                );
            }
            if (siti) {
                sampleAbsen.push(
                    { user_id: siti.id, tanggal: todayStr, waktu: '13:20:00', tipe_absen: 'Absen Masuk Siang', lokasi: 'Jarak: 8m dari Zieda Pusat', status: 'Terlambat', status_wajah: 'Sesuai', menit_terlambat: 20, menit_lembur: 0, keterangan_waktu: 'Terlambat 20m' },
                    { user_id: siti.id, tanggal: todayStr, waktu: '21:05:00', tipe_absen: 'Absen Pulang Siang', lokasi: 'Jarak: 6m dari Zieda Pusat', status: 'Hadir', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Pulang Normal' }
                );
            }
            if (rudi) {
                sampleAbsen.push(
                    { user_id: rudi.id, tanggal: todayStr, waktu: '07:45:00', tipe_absen: 'Absen Masuk Pagi', lokasi: 'Jarak: 3m dari Zieda Pusat', status: 'Hadir', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Tepat Waktu' },
                    { user_id: rudi.id, tanggal: todayStr, waktu: '12:00:00', tipe_absen: 'Istirahat Keluar', lokasi: 'Jarak: 2m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Meninggalkan Kantor' },
                    { user_id: rudi.id, tanggal: todayStr, waktu: '12:50:00', tipe_absen: 'Istirahat Masuk', lokasi: 'Jarak: 3m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Kembali ke Kantor' },
                    { user_id: rudi.id, tanggal: todayStr, waktu: '16:05:00', tipe_absen: 'Absen Pulang Pagi', lokasi: 'Jarak: 5m dari Zieda Pusat', status: 'Hadir', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Pulang Normal' }
                );
            }
            if (dewi) {
                sampleAbsen.push(
                    { user_id: dewi.id, tanggal: todayStr, waktu: '07:50:00', tipe_absen: 'Absen Masuk Pagi', lokasi: 'Jarak: 2m dari Zieda Pusat', status: 'Hadir', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Tepat Waktu' },
                    { user_id: dewi.id, tanggal: todayStr, waktu: '12:00:00', tipe_absen: 'Istirahat Keluar', lokasi: 'Jarak: 3m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Meninggalkan Kantor' },
                    { user_id: dewi.id, tanggal: todayStr, waktu: '12:45:00', tipe_absen: 'Istirahat Masuk', lokasi: 'Jarak: 4m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Kembali ke Kantor' },
                    { user_id: dewi.id, tanggal: todayStr, waktu: '18:00:00', tipe_absen: 'Istirahat Keluar', lokasi: 'Jarak: 3m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Meninggalkan Kantor (Lembur)' },
                    { user_id: dewi.id, tanggal: todayStr, waktu: '18:30:00', tipe_absen: 'Istirahat Masuk', lokasi: 'Jarak: 2m dari Zieda Pusat', status: 'Istirahat', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 0, keterangan_waktu: 'Kembali ke Kantor (Lembur)' },
                    { user_id: dewi.id, tanggal: todayStr, waktu: '21:30:00', tipe_absen: 'Absen Pulang Pagi', lokasi: 'Jarak: 5m dari Zieda Pusat', status: 'Lembur', status_wajah: 'Sesuai', menit_terlambat: 0, menit_lembur: 330, keterangan_waktu: 'Lembur 5j 30m' }
                );
            }
            if (sampleAbsen.length > 0) {
                const { error: errAbsen } = await supabaseClient.from('absensi').insert(sampleAbsen);
                if (errAbsen) {
                    console.error("[Factory Reset] Gagal insert sample absensi:", errAbsen);
                    throw new Error(`Gagal inisialisasi demo data absensi: ${errAbsen.message}`);
                }
            }
        }

        Swal.fire("Berhasil Reset & Inisialisasi", "Sistem telah direset dan diisi ulang dengan data starter template resmi.", "success").then(() => {
            window.location.reload();
        });
    } catch (err) {
        console.error("[Factory Reset Error]", err);
        Swal.fire("Gagal Reset", err.message || "Terjadi kesalahan saat memproses Factory Reset", "error");
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
            <td><small>${formatWaktuGlobal(item.jam_mulai)} s/d ${formatWaktuGlobal(item.jam_tutup)}</small></td>
            <td><small>${formatWaktuGlobal(item.batas_terlambat)}</small></td>
            <td>${item.is_checkout ? '<span class="badge bg-success">Ya</span>' : '<span class="badge bg-secondary">Tidak</span>'}</td>
            <td>
                <div class="form-check form-switch d-flex justify-content-center">
                    <input class="form-check-input" type="checkbox" ${item.is_aktif ? 'checked' : ''} onchange="toggleStatusTipeAbsen(${item.id}, this.checked)">
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-warning shadow-sm me-1" onclick="editTipeAbsen(${item.id}, '${item.nama_tipe}', '${item.jam_mulai || ''}', '${item.batas_terlambat || ''}', '${item.jam_tutup || ''}', ${item.is_checkout})"><i class="fas fa-edit me-1"></i>Edit</button>
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
    document.getElementById("tipe-absen-tutup").value = "";
    document.getElementById("tipe-absen-checkout").checked = false;
    const label = document.getElementById("modalTipeAbsenLabel");
    if(label) label.innerText = "Tambah Tipe Absen";
}

function editTipeAbsen(id, nama, mulai, batas, tutup, isCheckout) {
    document.getElementById("tipe-absen-id").value = id;
    document.getElementById("tipe-absen-nama").value = nama;
    document.getElementById("tipe-absen-mulai").value = mulai || '';
    document.getElementById("tipe-absen-batas").value = batas || '';
    document.getElementById("tipe-absen-tutup").value = tutup || '';
    document.getElementById("tipe-absen-checkout").checked = isCheckout === true || isCheckout === 'true';
    const label = document.getElementById("modalTipeAbsenLabel");
    if(label) label.innerText = "Edit Tipe Absen";
    new bootstrap.Modal(document.getElementById('modalTambahTipeAbsen')).show();
}

async function simpanTipeAbsen() {
    const id = document.getElementById("tipe-absen-id").value;
    const nama = document.getElementById("tipe-absen-nama").value.trim();
    const mulai = document.getElementById("tipe-absen-mulai").value || null;
    const batas = document.getElementById("tipe-absen-batas").value || null;
    const tutup = document.getElementById("tipe-absen-tutup").value || null;
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
            jam_tutup: tutup,
            is_checkout: isCheckout
        }).eq("id", id);
        error = res.error;
    } else {
        const res = await supabaseClient.from("master_tipe_absen").insert([{ 
            nama_tipe: nama,
            jam_mulai: mulai,
            batas_terlambat: batas,
            jam_tutup: tutup,
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

async function jalankanMigrasiDataShift() {
    const result = await Swal.fire({
        title: "Konfirmasi Migrasi Data Shift",
        text: "Sistem akan memindai riwayat absensi lama dan mengonversinya ke tipe shift presisi (Pagi/Siang/Sore/Malam) serta mengkalkulasi ulang durasi telat dan lembur. Lanjutkan?",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Ya, Jalankan Migrasi",
        cancelButtonText: "Batal",
        reverseButtons: true
    });

    if (!result.isConfirmed) return;

    const btn = document.getElementById("btn-run-migration");
    const progressContainer = document.getElementById("migration-progress-container");
    const progressBar = document.getElementById("migration-progress-bar");
    const statusText = document.getElementById("migration-status-text");

    if (btn) btn.disabled = true;
    if (progressContainer) progressContainer.classList.remove("d-none");

    try {
        // 1. Fetch master tipe absen untuk acuan jam shift & batas telat
        const { data: masterData, error: errMaster } = await supabaseClient
            .from('master_tipe_absen')
            .select('*');
        
        if (errMaster) throw errMaster;

        const masterTipeAbsen = masterData || [];
        const timeToMinutes = (tStr) => {
            if (!tStr) return 0;
            const parts = tStr.split(":");
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        };

        // 2. Fetch seluruh data absensi
        const { data: absensiList, error: errAbsen } = await supabaseClient
            .from('absensi')
            .select('*')
            .not('status', 'ilike', '%-TRASH-%');

        if (errAbsen) throw errAbsen;

        if (!absensiList || absensiList.length === 0) {
            Swal.fire("Informasi", "Tidak ditemukan data absensi untuk dimigrasikan.", "info");
            if (btn) btn.disabled = false;
            if (progressContainer) progressContainer.classList.add("d-none");
            return;
        }

        let updatedCount = 0;
        let totalCount = absensiList.length;

        for (let i = 0; i < totalCount; i++) {
            const row = absensiList[i];
            const pct = Math.round(((i + 1) / totalCount) * 100);
            if (progressBar) {
                progressBar.style.width = `${pct}%`;
                progressBar.innerText = `${pct}%`;
            }
            if (statusText) {
                statusText.innerText = `Memproses (${i + 1}/${totalCount}): ${row.tanggal} - ${row.tipe_absen}`;
            }

            let newTipeAbsen = row.tipe_absen;
            let status = row.status || "Hadir";
            let menitTerlambat = row.menit_terlambat || 0;
            let menitLembur = row.menit_lembur || 0;
            let keteranganWaktu = row.keterangan_waktu || "";

            const nTipe = (row.tipe_absen || "").toLowerCase();
            const waktuStr = row.waktu || "00:00:00";
            const currMin = timeToMinutes(waktuStr);

            // Klasifikasi Shift & Kalkulasi
            if (nTipe === "masuk" || nTipe === "absen masuk") {
                // Tentukan Shift Masuk berdasarkan Jam
                if (currMin < 660) { // < 11:00 AM ➔ Shift Pagi
                    newTipeAbsen = "Absen Masuk Pagi";
                } else if (currMin >= 660 && currMin < 960) { // 11:00 AM - 04:00 PM ➔ Shift Siang
                    newTipeAbsen = "Absen Masuk Siang";
                } else { // >= 04:00 PM ➔ Shift Sore
                    newTipeAbsen = "Absen Masuk Sore";
                }

                // Cari master tipe absen pencocokan
                const masterTarget = masterTipeAbsen.find(m => m.nama_tipe === newTipeAbsen) || 
                                     masterTipeAbsen.find(m => (m.nama_tipe || '').toLowerCase().includes('masuk'));

                if (masterTarget && masterTarget.batas_terlambat) {
                    const limitMin = timeToMinutes(masterTarget.batas_terlambat);
                    if (currMin > limitMin) {
                        status = "Terlambat";
                        menitTerlambat = currMin - limitMin;
                        const jam = Math.floor(menitTerlambat / 60);
                        const m = menitTerlambat % 60;
                        keteranganWaktu = `Terlambat ${jam > 0 ? jam + "j " : ""}${m}m`;
                    } else {
                        status = "Hadir";
                        menitTerlambat = 0;
                        keteranganWaktu = "Tepat Waktu";
                    }
                }
            } else if (nTipe === "pulang" || nTipe === "absen pulang" || nTipe === "checkout") {
                // Tentukan Shift Pulang berdasarkan Jam
                if (currMin < 1080) { // < 06:00 PM ➔ Pulang Pagi
                    newTipeAbsen = "Absen Pulang Pagi";
                } else if (currMin >= 1080 && currMin < 1380) { // 06:00 PM - 11:00 PM ➔ Pulang Siang
                    newTipeAbsen = "Absen Pulang Siang";
                } else { // >= 11:00 PM atau Dini Hari ➔ Pulang Malam
                    newTipeAbsen = "Absen Pulang Malam";
                }

                const masterTarget = masterTipeAbsen.find(m => m.nama_tipe === newTipeAbsen) || 
                                     masterTipeAbsen.find(m => m.is_checkout);

                if (masterTarget) {
                    const normalEndStr = masterTarget.batas_terlambat || (masterTarget.jam_tutup && masterTarget.jam_tutup !== '23:59:59' ? masterTarget.jam_tutup : null);
                    const limitMin = timeToMinutes(normalEndStr);
                    if (limitMin && currMin > limitMin) {
                        status = "Lembur";
                        const totalLemburKotor = currMin - limitMin;
                        const potonganIstirahat = masterTarget.potongan_lembur_menit !== undefined && masterTarget.potongan_lembur_menit !== null 
                            ? parseInt(masterTarget.potongan_lembur_menit, 10) : 0;

                        menitLembur = Math.max(0, totalLemburKotor - potonganIstirahat);
                        const jamLembur = Math.floor(menitLembur / 60);
                        const mLembur = menitLembur % 60;
                        keteranganWaktu = `Lembur ${jamLembur > 0 ? jamLembur + "j " : ""}${mLembur}m` + (potonganIstirahat > 0 ? ` (Potongan Istirahat ${potonganIstirahat}m)` : "");
                    } else {
                        status = "Hadir";
                        menitLembur = 0;
                        keteranganWaktu = "Pulang Normal";
                    }
                }
            } else if (!keteranganWaktu || row.menit_terlambat === null || row.menit_lembur === null) {
                // Tipe yang sudah bernama spesifik tapi belum punya keterangan waktu
                const masterTarget = masterTipeAbsen.find(m => m.nama_tipe === row.tipe_absen);
                if (masterTarget) {
                    const normalEndStr = masterTarget.batas_terlambat || (masterTarget.jam_tutup && masterTarget.jam_tutup !== '23:59:59' ? masterTarget.jam_tutup : null);
                    const limitEndMin = timeToMinutes(normalEndStr);
                    if (masterTarget.batas_terlambat && !masterTarget.is_checkout && currMin > timeToMinutes(masterTarget.batas_terlambat)) {
                        status = "Terlambat";
                        menitTerlambat = currMin - timeToMinutes(masterTarget.batas_terlambat);
                        const jam = Math.floor(menitTerlambat / 60);
                        const m = menitTerlambat % 60;
                        keteranganWaktu = `Terlambat ${jam > 0 ? jam + "j " : ""}${m}m`;
                    } else if (masterTarget.is_checkout && limitEndMin && currMin > limitEndMin) {
                        status = "Lembur";
                        const totalKotor = currMin - limitEndMin;
                        const pot = masterTarget.potongan_lembur_menit !== undefined && masterTarget.potongan_lembur_menit !== null 
                            ? parseInt(masterTarget.potongan_lembur_menit, 10) : 0;
                        menitLembur = Math.max(0, totalKotor - pot);
                        const jamLembur = Math.floor(menitLembur / 60);
                        const mLembur = menitLembur % 60;
                        keteranganWaktu = `Lembur ${jamLembur > 0 ? jamLembur + "j " : ""}${mLembur}m` + (pot > 0 ? ` (Potongan Istirahat ${pot}m)` : "");
                    } else {
                        keteranganWaktu = "Normal";
                    }
                }
            }

            // Update row ke Supabase
            const { error: errUpdate } = await supabaseClient
                .from('absensi')
                .update({
                    tipe_absen: newTipeAbsen,
                    status: status,
                    menit_terlambat: menitTerlambat,
                    menit_lembur: menitLembur,
                    keterangan_waktu: keteranganWaktu
                })
                .eq('id', row.id);

            if (!errUpdate) {
                updatedCount++;
            }
        }

        Swal.fire({
            title: "Migrasi Sukses!",
            html: `Berhasil memindai <b>${totalCount}</b> data absensi.<br>Sebanyak <b>${updatedCount}</b> data berhasil dimigrasikan ke tipe shift presisi & dikalkulasi ulang.`,
            icon: "success"
        });

        // Refresh data absensi di UI
        loadDataAbsensi();

    } catch (e) {
        console.error("Gagal Migrasi Data:", e);
        Swal.fire("Error Migrasi", e.message || "Gagal memigrasikan data absensi", "error");
    } finally {
        if (btn) btn.disabled = false;
        if (progressContainer) progressContainer.classList.add("d-none");
    }
}

// ==========================================
// TOOL EDIT WAKTU & PINDAH SHIFT ABSENSI (SUPER ADMIN)
// ==========================================
async function bukaModalEditAbsensi(id, tipeAbsen, waktu, tanggal) {
    if (!isSuperAdmin) {
        Swal.fire("Akses Ditolak", "Hanya Super Admin yang dapat mengedit data absensi.", "error");
        return;
    }
    document.getElementById("edit_absen_id").value = id;
    document.getElementById("edit_absen_tanggal").value = tanggal;
    document.getElementById("edit_absen_waktu").value = waktu && waktu !== '-' ? waktu : "08:00:00";
    document.getElementById("edit_absen_keterangan").value = "";

    const selectTipe = document.getElementById("edit_absen_tipe");
    selectTipe.innerHTML = '<option value="">Memuat tipe...</option>';

    try {
        const { data: masterData } = await supabaseClient.from("master_tipe_absen").select("*").eq("is_aktif", true).order("id", { ascending: true });
        if (masterData && masterData.length > 0) {
            selectTipe.innerHTML = masterData.map(m => `
                <option value="${m.nama_tipe}" ${m.nama_tipe === tipeAbsen ? 'selected' : ''}>${m.nama_tipe}</option>
            `).join('');
        } else {
            selectTipe.innerHTML = `<option value="${tipeAbsen}">${tipeAbsen}</option>`;
        }
    } catch(e) {
        selectTipe.innerHTML = `<option value="${tipeAbsen}">${tipeAbsen}</option>`;
    }

    const modalEl = document.getElementById("modalEditAbsensi");
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}
window.bukaModalEditAbsensi = bukaModalEditAbsensi;

async function simpanEditAbsensi() {
    const id = document.getElementById("edit_absen_id").value;
    const tanggal = document.getElementById("edit_absen_tanggal").value;
    const tipe_absen = document.getElementById("edit_absen_tipe").value;
    let waktu = document.getElementById("edit_absen_waktu").value;
    const ket_alasan = document.getElementById("edit_absen_keterangan").value;

    if (!id || !tipe_absen || !waktu) {
        Swal.fire("Peringatan", "Semua data wajib diisi.", "warning");
        return;
    }

    if (waktu.length === 5) waktu += ":00";

    try {
        Swal.fire({ title: "Menyimpan...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        // Hitung ulang status, menit_terlambat, dan menit_lembur berdasarkan master_tipe_absen
        const { data: masterList } = await supabaseClient.from("master_tipe_absen").select("*");
        const targetMaster = (masterList || []).find(m => m.nama_tipe === tipe_absen);

        let status = "Hadir";
        let menit_terlambat = 0;
        let menit_lembur = 0;
        let keterangan_waktu = ket_alasan || "Diperbarui oleh Super Admin";

        if (targetMaster) {
            const wMins = parseT(waktu);
            const bMins = parseT(targetMaster.batas_terlambat);

            if (targetMaster.is_checkout) {
                const normalEndStr = targetMaster.batas_terlambat || (targetMaster.jam_tutup && targetMaster.jam_tutup !== '23:59:59' ? targetMaster.jam_tutup : null);
                const bMins = parseT(normalEndStr);
                if (bMins && wMins > bMins) {
                    status = "Lembur";
                    menit_lembur = wMins - bMins;
                    keterangan_waktu = ket_alasan || `Lembur ${Math.floor(menit_lembur/60)}j ${menit_lembur%60}m`;
                } else {
                    status = "Hadir";
                    menit_lembur = 0;
                    keterangan_waktu = ket_alasan || "Pulang Normal";
                }
            } else if (targetMaster.nama_tipe.toLowerCase().includes("istirahat") || targetMaster.nama_tipe.toLowerCase().includes("izin")) {
                status = targetMaster.nama_tipe.toLowerCase().includes("istirahat") ? "Istirahat" : "Izin";
                keterangan_waktu = ket_alasan || targetMaster.nama_tipe;
            } else {
                if (bMins && wMins > bMins) {
                    status = "Terlambat";
                    menit_terlambat = wMins - bMins;
                    keterangan_waktu = ket_alasan || `Terlambat ${Math.floor(menit_terlambat/60)}j ${menit_terlambat%60}m`;
                } else {
                    status = "Hadir";
                    keterangan_waktu = ket_alasan || "Tepat Waktu";
                }
            }
        }

        const payload = {
            tipe_absen,
            waktu,
            status,
            menit_terlambat,
            menit_lembur,
            keterangan_waktu
        };

        let { error } = await supabaseClient.from("absensi").update(payload).eq("id", id);

        if (error && (error.code === 'PGRST204' || (error.message && (error.message.includes('menit_lembur') || error.message.includes('menit_terlambat') || error.message.includes('keterangan_waktu'))))) {
            console.warn("Beberapa kolom fitur presisi absensi belum ada di Supabase Cloud. Fallback update data dasar...");
            const fallbackPayload = { tipe_absen, waktu, status };
            const fallbackRes = await supabaseClient.from("absensi").update(fallbackPayload).eq("id", id);
            
            if (!fallbackRes.error) {
                const modalEl = document.getElementById("modalEditAbsensi");
                if (modalEl) {
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) modal.hide();
                }
                Swal.fire({
                    title: "Berhasil Diperbarui",
                    html: `Data absensi berhasil diperbarui.<br><br><small class="text-warning"><strong>⚠️ Catatan Tambahan:</strong> Database Supabase Cloud Anda belum memiliki kolom kalkulasi presisi.<br><br>Silakan jalankan SQL berikut di <strong>Supabase Dashboard (SQL Editor)</strong>:<br><code class="bg-dark text-white p-2 rounded d-block mt-2 text-start">ALTER TABLE absensi ADD COLUMN IF NOT EXISTS menit_terlambat INTEGER DEFAULT 0;<br>ALTER TABLE absensi ADD COLUMN IF NOT EXISTS menit_lembur INTEGER DEFAULT 0;<br>ALTER TABLE absensi ADD COLUMN IF NOT EXISTS keterangan_waktu TEXT;</code></small>`,
                    icon: "warning"
                }).then(() => {
                    if (typeof showDetailAbsensi === "function" && tanggal) showDetailAbsensi(tanggal);
                    if (typeof loadDataAbsensi === "function") loadDataAbsensi(false);
                });
                return;
            }
        }

        if (error) throw error;

        // AUTO-PAIR SHIFT TRANSFER FOR SUPER ADMIN:
        // Jika Super Admin memindahkan shift (misal Masuk Siang -> Masuk Pagi), otomatis pindahkan pasangan Pulang ke Shift Pagi juga!
        const currentGroupRecord = (allAbsensiGrouped[tanggal]?.records || []).find(r => String(r.id) === String(id));
        const targetUserId = currentGroupRecord ? currentGroupRecord.user_id : null;

        if (targetUserId && currentGroupRecord) {
            const newTipeLower = tipe_absen.toLowerCase();
            let shiftKeyword = '';
            if (newTipeLower.includes('pagi')) shiftKeyword = 'Pagi';
            else if (newTipeLower.includes('siang')) shiftKeyword = 'Siang';
            else if (newTipeLower.includes('malam')) shiftKeyword = 'Malam';

            if (shiftKeyword) {
                const siblingRecords = (allAbsensiGrouped[tanggal]?.records || []).filter(r => r.user_id === targetUserId && String(r.id) !== String(id));
                for (let sib of siblingRecords) {
                    const sibLower = sib.tipe_absen.toLowerCase();
                    let pairedTipeName = '';

                    if (newTipeLower.includes('masuk') && (sibLower.includes('pulang') || sibLower.includes('checkout'))) {
                        pairedTipeName = `Absen Pulang ${shiftKeyword}`;
                    } else if ((newTipeLower.includes('pulang') || newTipeLower.includes('checkout')) && sibLower.includes('masuk')) {
                        pairedTipeName = `Absen Masuk ${shiftKeyword}`;
                    }

                    if (pairedTipeName && sib.tipe_absen !== pairedTipeName) {
                        const sibMaster = (masterList || []).find(m => m.nama_tipe === pairedTipeName);
                        if (sibMaster) {
                            let pStatus = "Hadir";
                            let pTerlambat = 0;
                            let pLembur = 0;
                            let pKet = `Disesuaikan otomatis ke Shift ${shiftKeyword}`;

                            const sibWMins = parseT(sib.waktu);
                            const sibBMins = parseT(sibMaster.batas_terlambat);

                            if (sibMaster.is_checkout) {
                                if (sibBMins && sibWMins > sibBMins) {
                                    pStatus = "Lembur";
                                    pLembur = sibWMins - sibBMins;
                                    pKet = `Lembur ${Math.floor(pLembur/60)}j ${pLembur%60}m`;
                                } else {
                                    pStatus = "Hadir";
                                    pKet = "Pulang Normal";
                                }
                            } else {
                                if (sibBMins && sibWMins > sibBMins) {
                                    pStatus = "Terlambat";
                                    pTerlambat = sibWMins - sibBMins;
                                    pKet = `Terlambat ${Math.floor(pTerlambat/60)}j ${pTerlambat%60}m`;
                                }
                            }

                            const sibPayload = {
                                tipe_absen: pairedTipeName,
                                status: pStatus,
                                menit_terlambat: pTerlambat,
                                menit_lembur: pLembur,
                                keterangan_waktu: pKet
                            };

                            await supabaseClient.from("absensi").update(sibPayload).eq("id", sib.id);
                        }
                    }
                }
            }
        }

        const modalEl = document.getElementById("modalEditAbsensi");
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        Swal.fire("Berhasil", "Data absensi & pasangan shift berhasil diperbarui!", "success").then(() => {
            if (typeof showDetailAbsensi === "function" && tanggal) {
                showDetailAbsensi(tanggal);
            }
            if (typeof loadDataAbsensi === "function") {
                loadDataAbsensi(false);
            }
        });
    } catch (err) {
        console.error(err);
        Swal.fire("Error", err.message || "Gagal memperbarui absensi", "error");
    }
}
window.simpanEditAbsensi = simpanEditAbsensi;

// ==========================================
// BACKUP & RESTORE MODULAR PER SECTION
// ==========================================
function toggleSelectAllBackup(btn) {
    const chks = document.querySelectorAll('.check-backup-section');
    const allChecked = Array.from(chks).every(c => c.checked);
    chks.forEach(c => c.checked = !allChecked);
    btn.textContent = allChecked ? 'Pilih Semua' : 'Batal Pilih Semua';
}
window.toggleSelectAllBackup = toggleSelectAllBackup;

async function downloadBackupModular() {
    const selectedTables = Array.from(document.querySelectorAll('.check-backup-section:checked')).map(c => c.value);
    
    if (selectedTables.length === 0) {
        Swal.fire('Peringatan', 'Pilih minimal satu section data yang ingin dibackup!', 'warning');
        return;
    }

    try {
        Swal.fire({ title: 'Memproses Backup...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const backupData = {
            version: '2.0-modular',
            created_at: new Date().toISOString(),
            sections_included: selectedTables,
            data: {}
        };

        for (const tableName of selectedTables) {
            const { data, error } = await supabaseClient.from(tableName).select('*');
            if (error) {
                console.warn(`Gagal membaca tabel ${tableName}:`, error);
                backupData.data[tableName] = [];
            } else {
                backupData.data[tableName] = data || [];
            }
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
        const downloadAnchor = document.createElement('a');
        const filename = `backup_absensi_modular_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", filename);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        Swal.fire('Berhasil', `Backup ${selectedTables.length} section berhasil diunduh!`, 'success');
    } catch (err) {
        console.error(err);
        Swal.fire('Error', err.message || 'Gagal membuat backup', 'error');
    }
}
window.downloadBackupModular = downloadBackupModular;

let currentRestoreBackupObj = null;

function previewRestoreModular(event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('container-preview-restore');
    const listContainer = document.getElementById('list-restore-sections');
    const btnRestore = document.getElementById('btn-do-restore');

    if (!file) {
        if (previewContainer) previewContainer.classList.add('d-none');
        if (btnRestore) btnRestore.disabled = true;
        currentRestoreBackupObj = null;
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const backupObj = JSON.parse(e.target.result);
            if (!backupObj || (!backupObj.data && !backupObj.users)) {
                throw new Error("Format file JSON backup tidak valid.");
            }

            // Standardize format
            currentRestoreBackupObj = backupObj.data ? backupObj : { data: backupObj };

            const dataMap = currentRestoreBackupObj.data;
            const availableTables = Object.keys(dataMap);

            if (availableTables.length === 0) {
                throw new Error("File backup tidak memiliki data section.");
            }

            const labelNames = {
                users: '👤 Data Karyawan & Admin',
                master_tipe_absen: '⏰ Master Tipe Absen / Shift',
                app_settings: '⚙️ Pengaturan Aplikasi',
                master_cabang: '🏢 Master Kantor Cabang',
                master_jenis_cuti: '📋 Master Jenis Cuti & Kuota',
                form_cuti_config: '📄 Konfigurasi Form Cuti & Syarat',
                absensi: '📅 Transaksi Absensi',
                cuti: '🏖️ Data Pengajuan Cuti'
            };

            let html = '';
            availableTables.forEach(table => {
                const count = Array.isArray(dataMap[table]) ? dataMap[table].length : 0;
                const nameLabel = labelNames[table] || `📁 Tabel ${table}`;
                html += `
                    <div class="form-check mb-1">
                        <input class="form-check-input check-restore-section" type="checkbox" id="chk_r_${table}" value="${table}" checked>
                        <label class="form-check-label small" for="chk_r_${table}">
                            <strong>${nameLabel}</strong> (${count} data)
                        </label>
                    </div>
                `;
            });

            if (listContainer) listContainer.innerHTML = html;
            if (previewContainer) previewContainer.classList.remove('d-none');
            if (btnRestore) btnRestore.disabled = false;

        } catch (err) {
            console.error(err);
            Swal.fire("File Tidak Valid", err.message || "Gagal membaca file JSON.", "error");
            if (previewContainer) previewContainer.classList.add('d-none');
            if (btnRestore) btnRestore.disabled = true;
            currentRestoreBackupObj = null;
        }
    };
    reader.readAsText(file);
}
window.previewRestoreModular = previewRestoreModular;

async function prosesRestoreModular() {
    if (!currentRestoreBackupObj || !currentRestoreBackupObj.data) {
        Swal.fire("Peringatan", "Pilih file backup terlebih dahulu.", "warning");
        return;
    }

    const selectedTables = Array.from(document.querySelectorAll('.check-restore-section:checked')).map(c => c.value);

    if (selectedTables.length === 0) {
        Swal.fire("Peringatan", "Pilih minimal satu section yang ingin di-restore!", "warning");
        return;
    }

    const confirmRes = await Swal.fire({
        title: 'Konfirmasi Restore Data',
        html: `Apakah Anda yakin ingin mengembalikan <strong>${selectedTables.length} section data</strong> ke database?<br><small class="text-danger">Data yang cocok akan di-update/diterapkan ke sistem.</small>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Ya, Jalankan Restore',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#198754'
    });

    if (!confirmRes.isConfirmed) return;

    try {
        Swal.fire({ title: 'Proses Restore Data...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const dataMap = currentRestoreBackupObj.data;
        let totalRestoredCount = 0;

        for (const tableName of selectedTables) {
            const rows = dataMap[tableName];
            if (Array.isArray(rows) && rows.length > 0) {
                const { error } = await supabaseClient.from(tableName).upsert(rows, { onConflict: 'id' });
                if (error) {
                    console.error(`Gagal restore section ${tableName}:`, error);
                } else {
                    totalRestoredCount += rows.length;
                }
            }
        }

        Swal.fire('Restore Berhasil!', `Sebanyak ${totalRestoredCount} data dari ${selectedTables.length} section telah berhasil dipulihkan!`, 'success').then(() => {
            location.reload();
        });

    } catch (err) {
        console.error(err);
        Swal.fire('Error Restore', err.message || 'Gagal menjalankan restore.', 'error');
    }
}
window.prosesRestoreModular = prosesRestoreModular;

// ==========================================
// REALTIME & SILENT AUTO-SYNC ENGINE
// ==========================================
function initRealtimeAutoSync() {
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient.channel) {
            // Subscribe to Postgres absensi table changes via WebSocket
            const channel = supabaseClient
                .channel('realtime_absensi_auto_sync')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'absensi' }, (payload) => {
                    console.log('⚡ Realtime WebSocket notification received for absensi:', payload);
                    if (typeof loadDataAbsensi === 'function') {
                        loadDataAbsensi(false); // Silent background refresh
                    }
                })
                .subscribe((status) => {
                    console.log('Realtime absensi channel status:', status);
                });
        }
    } catch (e) {
        console.warn('Realtime WebSocket error:', e);
    }

    // Silent background polling fallback every 5 seconds (failsafe against WebSocket drops)
    setInterval(() => {
        if (typeof loadDataAbsensi === 'function') {
            const activeTab = document.querySelector('.nav-link.active');
            if (activeTab && activeTab.getAttribute('data-bs-target') === '#tab-absensi') {
                loadDataAbsensi(false);
            }
        }
    }, 5000);
}
window.initRealtimeAutoSync = initRealtimeAutoSync;

// FORM GAJI MINGGUAN (TIMESHEET PRINT/PDF)
// ==========================================
async function bukaModalFormGaji() {
    setPresetTanggalGaji('7hari');
    
    // Populate Cabang Dropdown
    const selectCabang = document.getElementById('gaji_cabang');
    if (selectCabang) {
        selectCabang.innerHTML = '<option value="">Semua Cabang</option>';
        let kantorList = (typeof globalKantorList !== 'undefined' && globalKantorList) ? globalKantorList : [];
        
        if (kantorList.length === 0 && typeof supabaseClient !== 'undefined') {
            try {
                const { data } = await supabaseClient.from('kantor').select('nama').order('nama');
                if (data) kantorList = data;
            } catch(e) {}
        }

        kantorList.forEach(k => {
            const namaKantor = k.nama || k.nama_kantor || '';
            if (namaKantor) {
                const opt = document.createElement('option');
                opt.value = namaKantor;
                opt.textContent = namaKantor;
                selectCabang.appendChild(opt);
            }
        });
        
        // Jika admin cabang, kunci pilihan cabang
        const currentUserData = localStorage.getItem('userLogin');
        if (currentUserData) {
            try {
                const u = JSON.parse(currentUserData);
                if (u.role !== 'Super Admin' && u.cabang) {
                    selectCabang.value = u.cabang;
                    selectCabang.disabled = true;
                }
            } catch(e) {}
        }
    }

    const modalEl = document.getElementById('modalFormGaji');
    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        try {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        } catch(e) {
            console.error('Modal error:', e);
        }
    }
}

function setPresetTanggalGaji(presetType) {
    const today = new Date();
    let dStart = new Date();
    let dEnd = new Date();

    if (presetType === '7hari') {
        dStart.setDate(today.getDate() - 6);
        dEnd = today;
    } else if (presetType === 'mingguini') {
        const day = today.getDay(); // 0: Sun, 1: Mon...
        const diffToMon = (day === 0 ? -6 : 1 - day);
        dStart.setDate(today.getDate() + diffToMon);
        dEnd = new Date(dStart);
        dEnd.setDate(dStart.getDate() + 6);
    }

    const formatYMD = (d) => d.toISOString().split('T')[0];
    
    const inpMulai = document.getElementById('gaji_mulai');
    const inpSelesai = document.getElementById('gaji_selesai');
    if (inpMulai) inpMulai.value = formatYMD(dStart);
    if (inpSelesai) inpSelesai.value = formatYMD(dEnd);
}

function prosesCetakFormGaji(event) {
    if (event) event.preventDefault();

    const tglMulai = document.getElementById('gaji_mulai').value;
    const tglSelesai = document.getElementById('gaji_selesai').value;
    const cabang = document.getElementById('gaji_cabang').value;

    if (!tglMulai || !tglSelesai) {
        Swal.fire('Perhatian', 'Silakan pilih tanggal mulai dan tanggal selesai.', 'warning');
        return;
    }

    const dStart = new Date(tglMulai);
    const dEnd = new Date(tglSelesai);
    const diffTime = dEnd - dStart;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays <= 0) {
        Swal.fire('Perhatian', 'Tanggal selesai harus sama atau setelah tanggal mulai.', 'warning');
        return;
    }

    if (diffDays > 7) {
        Swal.fire('Rentang Melebihi Limit', `Form Gaji Mingguan khusus untuk 1 minggu (maksimal 7 hari). Rentang yang Anda pilih adalah ${diffDays} hari.`, 'warning');
        return;
    }

    // Close Modal
    const modalEl = document.getElementById('modalFormGaji');
    if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }

    // Open print-gaji.html in new tab
    const url = `print-gaji.html?mulai=${encodeURIComponent(tglMulai)}&selesai=${encodeURIComponent(tglSelesai)}&cabang=${encodeURIComponent(cabang)}`;
    window.open(url, '_blank');
}

window.bukaModalFormGaji = bukaModalFormGaji;
window.setPresetTanggalGaji = setPresetTanggalGaji;
window.prosesCetakFormGaji = prosesCetakFormGaji;

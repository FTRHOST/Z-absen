// admin.js - Logika Khusus Halaman Admin

const currentUserData = localStorage.getItem('userLogin');
const currentUser = currentUserData ? JSON.parse(currentUserData) : {};
const isSuperAdmin = currentUser.role === 'Super Admin';
const myCabang = currentUser.cabang || '';

// Pastikan elemen dimuat
document.addEventListener("DOMContentLoaded", () => {
    // Sembunyikan menu atau opsi tertentu jika bukan Super Admin
    if (!isSuperAdmin) {
        const roleDropdown = document.getElementById("role-karyawan");
        if (roleDropdown) {
            const optHr = document.getElementById("opt-hr");
            if(optHr) optHr.style.display = 'none'; // HR tidak bisa buat HR baru
        }
        const btnKonfigCuti = document.getElementById("btn-konfigurasi-cuti");
        if (btnKonfigCuti) btnKonfigCuti.style.display = 'none'; // HR tidak boleh masuk ke Form Builder
    }

    // Muat data awal
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
});

let adminMap = null;
let adminMarker = null;

function initAdminMap() {
    if (adminMap) return;
    const mapEl = document.getElementById('map-kantor');
    if (!mapEl) return;
    
    adminMap = L.map('map-kantor').setView([-6.200000, 106.816666], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(adminMap);
    
    adminMap.on('click', function(e) {
        setMapLocation(e.latlng.lat, e.latlng.lng);
    });
}

function setMapLocation(lat, lng) {
    document.getElementById('kantor_lat').value = parseFloat(lat).toFixed(6);
    document.getElementById('kantor_lng').value = parseFloat(lng).toFixed(6);
    if (adminMarker) adminMap.removeLayer(adminMarker);
    adminMarker = L.marker([lat, lng]).addTo(adminMap);
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
async function loadDashboardStats() {
    let qUser = supabaseClient.from('users').select('*', { count: 'exact', head: true });
    let qHadir = supabaseClient.from('absensi').select('*, users!inner(*)', { count: 'exact', head: true }).eq('tanggal', new Date().toISOString().split('T')[0]);

    if (!isSuperAdmin) {
        qUser = qUser.eq('cabang', myCabang);
        qHadir = qHadir.eq('users.cabang', myCabang);
    }

    const { count: countUser } = await qUser;
    const { count: countKantor } = await supabaseClient.from('kantor').select('*', { count: 'exact', head: true });
    
    // Hitung Hadir Hari Ini
    const { count: countHadirResult } = await qHadir;

    // Update UI (jika ada elemen dengan ID ini, bisa ditambahkan nanti di HTML)
    const statHadirEl = document.getElementById("stat-hadir");
    const statUserEl = document.getElementById("stat-user");
    
    if (statHadirEl) statHadirEl.innerText = countHadirResult || 0;
    if (statUserEl) statUserEl.innerText = countUser || 0;
}

// =====================================
// 2. KELOLA KANTOR
// =====================================
async function loadDataKantor() {
    const tbody = document.querySelector("#tab-kantor tbody");
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Memuat data...</td></tr>';
    
    let queryKantor = supabaseClient.from('kantor').select('*').order('nama', { ascending: true });
    if (!isSuperAdmin) {
        queryKantor = queryKantor.eq('nama', myCabang); // HR hanya bisa melihat cabangnya
        
        // Ubah UI form untuk mode Edit saja
        document.getElementById('kantor-card-header').innerText = '✏️ Edit Informasi Koordinat Cabang Anda';
        document.getElementById('kantor_nama').disabled = true; // Jangan boleh ganti nama cabang
    } else {
        document.getElementById('kantor-card-header').innerText = '➕ Tambah Kantor Baru / Edit';
    }

    const { data, error } = await queryKantor;
    if (error) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-danger">Gagal memuat data</td></tr>';
        return;
    }
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Belum ada data kantor</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(kantor => {
        let hapusBtn = isSuperAdmin ? `<button class="btn btn-sm btn-danger" onclick="hapusKantor('${kantor.id}')">Hapus</button>` : '';
        tbody.innerHTML += `
            <tr>
                <td>${kantor.nama}</td>
                <td>${kantor.latitude}, ${kantor.longitude} <br> <small class="text-muted">Rad: ${kantor.radius}m</small></td>
                <td>Masuk: ${kantor.jam_masuk || '08:00'} <br> Pulang: ${kantor.jam_keluar || '17:00'}<br>
                <small class="text-muted">Istirahat: ${kantor.jam_mulai_istirahat || '12:00'} - ${kantor.jam_selesai_istirahat || '13:00'}</small></td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="editKantor('${kantor.id}', '${kantor.nama}', '${kantor.latitude}', '${kantor.longitude}', '${kantor.radius}', '${kantor.jam_masuk || '08:00:00'}', '${kantor.jam_keluar || '17:00:00'}', '${kantor.jam_mulai_istirahat || '12:00:00'}', '${kantor.jam_selesai_istirahat || '13:00:00'}')">Edit</button>
                    ${hapusBtn}
                </td>
            </tr>
        `;
    });
}

function editKantor(id, nama, lat, lng, rad, masuk, keluar, mulaiIstirahat, selesaiIstirahat) {
    document.getElementById('kantor_id').value = id;
    document.getElementById('kantor_nama').value = nama;
    document.getElementById('kantor_rad').value = rad;
    document.getElementById('kantor_jam_masuk').value = masuk;
    document.getElementById('kantor_jam_keluar').value = keluar;
    document.getElementById('kantor_jam_mulai_istirahat').value = mulaiIstirahat;
    document.getElementById('kantor_jam_selesai_istirahat').value = selesaiIstirahat;
    document.getElementById('kantor_btn').innerText = 'Update Data Cabang';
    document.getElementById('kantor_btn_batal').classList.remove('d-none');
    document.getElementById('kantor-card-header').innerText = '✏️ Edit Data Kantor';

    initAdminMap();
    if (lat && lng) {
        setMapLocation(lat, lng);
    }
    
    // Smooth scroll to form
    document.getElementById('form-kantor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function batalEditKantor() {
    document.getElementById('form-kantor').reset();
    document.getElementById('kantor_id').value = '';
    document.getElementById('kantor_btn').innerText = 'Simpan Data Cabang';
    document.getElementById('kantor_btn_batal').classList.add('d-none');
    document.getElementById('kantor-card-header').innerText = '➕ Tambah Kantor Baru';
    if (adminMarker) adminMap.removeLayer(adminMarker);
}

async function simpanKantor(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    
    const id = document.getElementById('kantor_id').value;
    const nama = document.getElementById('kantor_nama').value;
    const lat = document.getElementById('kantor_lat').value;
    const lng = document.getElementById('kantor_lng').value;
    const rad = document.getElementById('kantor_rad').value;
    const masuk = document.getElementById('kantor_jam_masuk').value;
    const keluar = document.getElementById('kantor_jam_keluar').value;
    const mulaiIstirahat = document.getElementById('kantor_jam_mulai_istirahat').value;
    const selesaiIstirahat = document.getElementById('kantor_jam_selesai_istirahat').value;
    
    let res;
    if (id) {
        res = await supabaseClient.from('kantor').update({
            nama: nama,
            latitude: lat,
            longitude: lng,
            radius: rad,
            jam_masuk: masuk,
            jam_keluar: keluar,
            jam_mulai_istirahat: mulaiIstirahat,
            jam_selesai_istirahat: selesaiIstirahat
        }).eq('id', id);
    } else {
        res = await supabaseClient.from('kantor').insert([
            { 
              nama: nama, latitude: lat, longitude: lng, radius: rad, 
              jam_masuk: masuk, jam_keluar: keluar,
              jam_mulai_istirahat: mulaiIstirahat, jam_selesai_istirahat: selesaiIstirahat
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
}

async function hapusKantor(id) {
    if (!confirm("Yakin ingin menghapus kantor ini?")) return;
    await supabaseClient.from('kantor').delete().eq('id', id);
    loadDataKantor();
}

// =====================================
// 3. KELOLA KARYAWAN
// =====================================
async function loadDataKaryawan() {
    const tbody = document.querySelector("#tab-karyawan tbody");
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Memuat data...</td></tr>';
    let queryUser = supabaseClient.from('users').select('*').order('nama', { ascending: true });
    if (!isSuperAdmin) {
        queryUser = queryUser.eq('cabang', myCabang);
    }
    const { data, error } = await queryUser;
    
    if (error) return;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Belum ada data pengguna</td></tr>';
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

    tbody.innerHTML = '';
    const namaHariLibur = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    data.forEach(user => {
        const badgeColor = user.role === 'HR' ? 'primary' : (user.role === 'Super Admin' ? 'danger' : 'secondary');
        
        let liburTeks = "Tidak Ada";
        if (user.hari_libur) {
            const arrLibur = user.hari_libur.split(',').map(Number);
            const strLibur = arrLibur.map(d => namaHariLibur[d]).join(', ');
            if (strLibur) liburTeks = strLibur;
        }

        tbody.innerHTML += `
            <tr>
                <td>${user.nama}</td>
                <td><span class="badge bg-${badgeColor}">${user.role}</span></td>
                <td>${user.no_hp || '-'}</td>
                <td>${user.cabang || '-'}</td>
                <td><small>${liburTeks}</small></td>
                <td>
                    <button class="btn btn-sm btn-outline-warning" onclick="editKaryawan('${user.id}', '${user.nama}', '${user.role}', '${user.no_hp || ''}', '${user.cabang || ''}')">Edit</button>
                    <button class="btn btn-sm btn-outline-info" onclick="editHariLibur('${user.id}', '${user.nama}', '${user.hari_libur || ''}')">Set Libur</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="hapusKaryawan('${user.id}')">Hapus</button>
                </td>
            </tr>
        `;
    });
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
    
    // Libur hanya di-handle saat insert. Update libur ada tombol khususnya.
    const liburCheckboxes = document.querySelectorAll('.form-libur-baru:checked');
    const hari_libur = Array.from(liburCheckboxes).map(c => c.value).join(',');

    let res;
    if (id) {
        // Edit Mode
        const updateData = { nama, no_hp, cabang };
        
        // Super Admin boleh ubah role
        if (isSuperAdmin) {
            updateData.role = role;
        }
        
        // Hanya update password jika diisi
        if (password.trim() !== '') {
            updateData.password = password;
        }

        res = await supabaseClient.from('users').update(updateData).eq('id', id);
    } else {
        // Insert Mode
        if (!password) {
            Swal.fire("Gagal", "Password wajib diisi untuk karyawan baru", "error");
            btn.disabled = false;
            return;
        }
        res = await supabaseClient.from('users').insert([
            { nama, password, role, no_hp, cabang, hari_libur, sisa_cuti: 12 }
        ]);
    }

    btn.disabled = false;
    if (res.error) return Swal.fire("Gagal", res.error.message, "error");
    
    Swal.fire("Sukses", `Data Karyawan berhasil ${id ? 'diperbarui' : 'ditambahkan'}!`, "success");
    batalEditKaryawan();
    loadDataKaryawan();
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
    
    document.getElementById("karyawan-card-header").innerText = "✏️ Edit Data Pengguna";
    document.getElementById("karyawan_btn").innerText = "Update Data";
    document.getElementById("karyawan_btn_batal").classList.remove("d-none");
    
    // Batasi perubahan role jika bukan Super Admin
    if (!isSuperAdmin) {
        document.getElementById("role-karyawan").disabled = true;
    }
    
    document.getElementById("form-karyawan").scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function batalEditKaryawan() {
    document.getElementById("form-karyawan").reset();
    document.getElementById("karyawan_id").value = '';
    document.getElementById("karyawan_password").placeholder = "Password (Wajib)";
    
    document.getElementById("karyawan-card-header").innerText = "➕ Tambah Pengguna Baru";
    document.getElementById("karyawan_btn").innerText = "Simpan Data";
    document.getElementById("karyawan_btn_batal").classList.add("d-none");
    
    if (!isSuperAdmin) {
        document.getElementById("role-karyawan").disabled = false;
        const selectCabang = document.getElementById("pilih-cabang");
        selectCabang.value = myCabang;
        selectCabang.disabled = true;
    }
}

async function hapusKaryawan(id) {
    if (!confirm("Yakin ingin menghapus karyawan ini?")) return;
    await supabaseClient.from('users').delete().eq('id', id);
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
async function loadDataAbsensi() {
    const tbody = document.querySelector("#tab-absensi tbody");
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Memuat data...</td></tr>';
    // Gunakan JOIN di Supabase
    let queryAbsen = supabaseClient.from('absensi').select('*, users!inner(nama, cabang)').order('created_at', { ascending: false });
    if (!isSuperAdmin) {
        queryAbsen = queryAbsen.eq('users.cabang', myCabang);
    }
    const { data, error } = await queryAbsen;
    
    if (error) {
        console.error("Error Absensi:", error);
        tbody.innerHTML = '<tr><td colspan="8" class="text-danger">Gagal memuat absensi: ' + error.message + '</td></tr>';
        return;
    }

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Belum ada data absensi hari ini</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(absen => {
        const fotoHTML = `<button class="btn btn-sm btn-info text-white shadow-sm" onclick="lihatFotoAbsen('${absen.foto_url || ''}', '${absen.foto_istirahat_keluar || ''}', '${absen.foto_istirahat_masuk || ''}', '${absen.foto_keluar || ''}')">📸 Lihat Foto</button>`;
            
        let badgeClass = "bg-secondary";
        if (absen.status === "Hadir") badgeClass = "bg-success";
        else if (absen.status === "Terlambat") badgeClass = "bg-warning text-dark";
        else if (absen.status === "Alpha") badgeClass = "bg-danger";

        const statusHTML = `
            <span class="badge ${badgeClass} fs-6">${absen.status}</span>
            <div class="small text-muted mt-1">Jarak: ${absen.jarak_meter || 0}m</div>
        `;
            
        let isLateBreak = false;
        // Kita asumsikan telat jika lebih dari 13:00:00. Jika ada data dinamis, butuh logic tambahan.
        if (absen.waktu_istirahat_masuk && absen.waktu_istirahat_masuk > "13:00:00") {
            isLateBreak = true;
        }

        tbody.innerHTML += `
            <tr>
                <td>${absen.users?.nama || 'Unknown'}</td>
                <td>${absen.users?.cabang || '-'}</td>
                <td>${absen.waktu_masuk || '-'}</td>
                <td>${absen.waktu_istirahat_keluar || '-'}</td>
                <td>${absen.waktu_istirahat_masuk || '-'} ${isLateBreak ? '<br><span class="badge bg-danger">Terlambat</span>' : ''}</td>
                <td>${absen.waktu_keluar || '-'}</td>
                <td>${fotoHTML}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
}

function lihatFotoAbsen(masuk, istKeluar, istMasuk, pulang) {
    let html = '<div class="d-flex flex-column gap-2 text-start">';
    
    if (masuk) html += `<a href="${masuk}" target="_blank" class="btn btn-outline-primary">📸 Foto Masuk</a>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Masuk (Belum ada)</button>`;
    
    if (istKeluar) html += `<a href="${istKeluar}" target="_blank" class="btn btn-outline-info">📸 Foto Mulai Istirahat</a>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Mulai Istirahat (Belum ada)</button>`;
    
    if (istMasuk) html += `<a href="${istMasuk}" target="_blank" class="btn btn-outline-info">📸 Foto Selesai Istirahat</a>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Selesai Istirahat (Belum ada)</button>`;
    
    if (pulang) html += `<a href="${pulang}" target="_blank" class="btn btn-outline-warning">📸 Foto Pulang</a>`;
    else html += `<button class="btn btn-outline-secondary" disabled>📸 Foto Pulang (Belum ada)</button>`;
    
    html += '</div>';

    Swal.fire({
        title: "Dokumentasi Foto",
        html: html,
        showConfirmButton: true,
        confirmButtonText: "Tutup"
    });
}

// =====================================
// 5. DATA CUTI
// =====================================
async function loadDataCuti() {
    const tbody = document.querySelector("#tab-cuti tbody");
    const theadTr = document.querySelector("#tab-cuti thead tr");
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">Memuat data...</td></tr>';
    
    // Ambil konfigurasi form untuk menjadi header kolom dinamis
    const { data: formConfig } = await supabaseClient.from('form_cuti_config').select('label').order('urutan', { ascending: true });
    let dynamicHeaders = [];
    if (formConfig) {
        dynamicHeaders = formConfig.map(f => f.label);
    }

    // Bangun ulang Thead
    let theadHTML = `
        <th>Nama Karyawan</th>
        <th>Tanggal Cuti</th>
    `;
    dynamicHeaders.forEach(label => {
        theadHTML += `<th>${label}</th>`;
    });
    theadHTML += `
        <th>Durasi</th>
        <th>Aksi / Status</th>
    `;
    if(theadTr) theadTr.innerHTML = theadHTML;
    let queryCuti = supabaseClient.from('cuti').select('*, users!inner(nama, cabang)').order('tanggal_mulai', { ascending: false });
    if (!isSuperAdmin) {
        queryCuti = queryCuti.eq('users.cabang', myCabang);
    }
    const { data, error } = await queryCuti;
    
    if (error || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${4 + dynamicHeaders.length}" class="text-muted">Belum ada pengajuan cuti</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    data.forEach(cuti => {
        let aksiHTML = '';
        if (cuti.status_pengajuan === 'Menunggu') {
            aksiHTML = `
                <button class="btn btn-sm btn-success mb-1" onclick="prosesCuti('${cuti.id}', '${cuti.user_id}', ${cuti.durasi_hari}, 'Disetujui')">Setujui</button>
                <button class="btn btn-sm btn-danger mb-1" onclick="prosesCuti('${cuti.id}', null, null, 'Ditolak')">Tolak</button>
            `;
        } else {
            aksiHTML = `
                <span class="badge bg-${cuti.status_pengajuan === 'Disetujui' ? 'success' : 'danger'} d-block mb-1">${cuti.status_pengajuan}</span>
                <button class="btn btn-sm btn-outline-secondary w-100 mb-1" onclick="editStatusCuti('${cuti.id}', '${cuti.status_pengajuan}')">Edit Status</button>
            `;
        }
        // Tombol hapus selalu ada
        aksiHTML += `<button class="btn btn-sm btn-outline-danger w-100" onclick="hapusCuti('${cuti.id}')">Hapus</button>`;

        let trHTML = `<tr>
            <td>${cuti.users?.nama || 'Unknown'}</td>
            <td>${cuti.tanggal_mulai} <br>s/d<br> ${cuti.tanggal_selesai}</td>
        `;
        
        // Loop dynamic headers
        dynamicHeaders.forEach(label => {
            let val = (cuti.data_tambahan && cuti.data_tambahan[label]) ? cuti.data_tambahan[label] : '-';
            if (val.toString().startsWith('http')) {
                val = `<a href="${val}" target="_blank" class="btn btn-sm btn-outline-info">File</a>`;
            }
            // Khusus alasan, jika kosong di data_tambahan tapi ada di cuti.alasan (backward compatible)
            if (label.toLowerCase().includes('alasan') && val === '-' && cuti.alasan) {
                val = cuti.alasan;
            }
            trHTML += `<td>${val}</td>`;
        });

        trHTML += `
            <td>${cuti.durasi_hari} Hari</td>
            <td>${aksiHTML}</td>
        </tr>`;
        tbody.innerHTML += trHTML;
    });
}

async function prosesCuti(cuti_id, user_id, durasi, status) {
    if (!confirm(`Yakin ingin mengubah status menjadi: ${status}?`)) return;
    
    // Update status cuti
    await supabaseClient.from('cuti').update({ status_pengajuan: status }).eq('id', cuti_id);
    
    Swal.fire("Berhasil", `Cuti ${status}`, "success");
    loadDataCuti();
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
    }
}

async function hapusCuti(cuti_id) {
    if (!confirm("Peringatan: Data pengajuan cuti ini akan dihapus permanen. Lanjutkan?")) return;
    
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
        document.getElementById('field-urutan').value = '0';
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
    data.forEach(f => {
        tbody.innerHTML += `
            <tr>
                <td>${f.label}</td>
                <td><span class="badge bg-secondary">${f.tipe}</span></td>
                <td>${f.opsi ? f.opsi : '-'}</td>
                <td>${f.wajib ? 'Wajib' : 'Opsional'}</td>
                <td>${f.urutan}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editFieldCuti('${f.id}')">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="hapusFieldCuti('${f.id}')">Hapus</button>
                </td>
            </tr>
        `;
    });
}

function editFieldCuti(id) {
    if(!window.formCutiConfigData) return;
    const f = window.formCutiConfigData.find(item => item.id === id);
    if(!f) return;

    const el = document.getElementById('modalFormBuilder');
    if(!formCutiModalInstance) formCutiModalInstance = new bootstrap.Modal(el);

    document.getElementById('field-id').value = f.id;
    document.getElementById('field-label').value = f.label;
    document.getElementById('field-tipe').value = f.tipe;
    document.getElementById('field-opsi').value = f.opsi || '';
    document.getElementById('field-wajib').value = f.wajib ? 'true' : 'false';
    document.getElementById('field-urutan').value = f.urutan;
    
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
    const urutan = parseInt(document.getElementById('field-urutan').value);

    let payload = { label, tipe, opsi, wajib, urutan };
    let res;

    if (id) {
        res = await supabaseClient.from('form_cuti_config').update(payload).eq('id', id);
    } else {
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
    if(!confirm('Hapus field ini dari form cuti?')) return;
    await supabaseClient.from('form_cuti_config').delete().eq('id', id);
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
    const m = window.masterCutiData.find(item => item.id === id);
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

    if (id) {
        await supabaseClient.from('master_jenis_cuti').update(payload).eq('id', id);
    } else {
        await supabaseClient.from('master_jenis_cuti').insert([payload]);
    }

    modalMasterCutiInstance.hide();
    Swal.fire("Berhasil", "Master Cuti berhasil disimpan!", "success");
    loadMasterCuti();
}

async function hapusMasterCuti(id) {
    if(!confirm("Yakin ingin menghapus master cuti ini?")) return;
    await supabaseClient.from('master_jenis_cuti').delete().eq('id', id);
    Swal.fire("Terhapus", "Data berhasil dihapus.", "success");
    loadMasterCuti();
}

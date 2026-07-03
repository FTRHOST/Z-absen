// admin.js - Logika Khusus Halaman Admin

// Pastikan elemen dimuat
document.addEventListener("DOMContentLoaded", () => {
    // Muat data awal
    loadDashboardStats();
    loadDataKantor();
    loadDataKaryawan();
    loadDataAbsensi();
    loadDataCuti();
});

// =====================================
// 1. DASHBOARD STATS
// =====================================
async function loadDashboardStats() {
    const { count: countUser } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: countKantor } = await supabaseClient.from('kantor').select('*', { count: 'exact', head: true });
    
    // Asumsi: Menghitung absensi hari ini (Dummy if no date filter yet)
    const { count: countHadir } = await supabaseClient.from('absensi').select('*', { count: 'exact', head: true }).eq('tanggal', new Date().toISOString().split('T')[0]);

    // Update UI (jika ada elemen dengan ID ini, bisa ditambahkan nanti di HTML)
    // document.getElementById('stat-user').innerText = countUser || 0;
}

// =====================================
// 2. KELOLA KANTOR
// =====================================
async function loadDataKantor() {
    const tbody = document.querySelector("#tab-kantor tbody");
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from('kantor').select('*').order('nama', { ascending: true });
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
        tbody.innerHTML += `
            <tr>
                <td>${kantor.nama}</td>
                <td>${kantor.latitude}, ${kantor.longitude}</td>
                <td>${kantor.radius}m</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="hapusKantor('${kantor.id}')">Hapus</button>
                </td>
            </tr>
        `;
    });
}

async function simpanKantor(event) {
    event.preventDefault();
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const nama = event.target.elements[0].value;
    const lat = event.target.elements[1].value;
    const lon = event.target.elements[2].value;
    const radius = event.target.elements[3].value;

    const { error } = await supabaseClient.from('kantor').insert([
        { nama, latitude: parseFloat(lat), longitude: parseFloat(lon), radius: parseInt(radius) }
    ]);

    btn.disabled = false;
    if (error) return Swal.fire("Gagal", error.message, "error");
    
    Swal.fire("Sukses", "Data kantor berhasil ditambahkan!", "success");
    event.target.reset();
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
    
    const { data, error } = await supabaseClient.from('users').select('*').order('nama', { ascending: true });
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
            selectCabang.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
        });
    }

    tbody.innerHTML = '';
    data.forEach(user => {
        const badgeColor = user.role === 'HR' ? 'primary' : (user.role === 'Super Admin' ? 'danger' : 'secondary');
        tbody.innerHTML += `
            <tr>
                <td>${user.nama}</td>
                <td><span class="badge bg-${badgeColor}">${user.role}</span></td>
                <td>${user.no_hp || '-'}</td>
                <td>${user.cabang || '-'}</td>
                <td>${user.sisa_cuti} Hari</td>
                <td>
                    <button class="btn btn-sm btn-outline-info" onclick="editSisaCuti('${user.id}', '${user.nama}', ${user.sisa_cuti})">Cuti</button>
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

    const role = document.getElementById("role-karyawan").value;
    const nama = event.target.elements[1].value;
    const no_hp = event.target.elements[2].value;
    const password = event.target.elements[3].value;
    const cabang = event.target.elements[4].value;

    const { error } = await supabaseClient.from('users').insert([
        { nama, password, role, no_hp, cabang, sisa_cuti: 12 }
    ]);

    btn.disabled = false;
    if (error) return Swal.fire("Gagal", error.message, "error");
    
    Swal.fire("Sukses", "Data Karyawan berhasil ditambahkan!", "success");
    event.target.reset();
    loadDataKaryawan();
}

async function hapusKaryawan(id) {
    if (!confirm("Yakin ingin menghapus karyawan ini?")) return;
    await supabaseClient.from('users').delete().eq('id', id);
    loadDataKaryawan();
}

async function editSisaCuti(id, nama, currentSisa) {
    const { value: sisaBaru } = await Swal.fire({
        title: `Atur Sisa Cuti - ${nama}`,
        input: 'number',
        inputValue: currentSisa,
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        inputValidator: (value) => {
            if (!value) return 'Sisa cuti tidak boleh kosong!';
            if (value < 0) return 'Tidak boleh kurang dari 0!';
        }
    });

    if (sisaBaru) {
        await supabaseClient.from('users').update({ sisa_cuti: parseInt(sisaBaru) }).eq('id', id);
        Swal.fire('Berhasil', 'Sisa cuti diperbarui', 'success');
        loadDataKaryawan();
    }
}

// =====================================
// 4. DATA ABSENSI
// =====================================
async function loadDataAbsensi() {
    const tbody = document.querySelector("#tab-absensi tbody");
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Memuat data...</td></tr>';
    
    // Gunakan JOIN di Supabase
    const { data, error } = await supabaseClient.from('absensi').select('*, users(nama, cabang)').order('created_at', { ascending: false });
    
    if (error) {
        console.error("Error Absensi:", error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-danger">Gagal memuat absensi: ' + error.message + '</td></tr>';
        return;
    }

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Belum ada data absensi hari ini</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(absen => {
        const fotoHTML = absen.foto_url 
            ? `<a href="${absen.foto_url}" target="_blank" class="badge bg-secondary text-decoration-none">Lihat Foto</a>` 
            : '-';
            
        const statusHTML = absen.status === 'Hadir' 
            ? `<span class="text-success fw-bold">${absen.jarak_meter}m (Valid)</span>`
            : `<span class="text-danger fw-bold">${absen.status}</span>`;

        tbody.innerHTML += `
            <tr>
                <td>${absen.users?.nama || 'Unknown'}</td>
                <td>${absen.users?.cabang || '-'}</td>
                <td>${absen.waktu_masuk || '-'}</td>
                <td>${fotoHTML}</td>
                <td>${statusHTML}</td>
            </tr>
        `;
    });
}

// =====================================
// 5. DATA CUTI
// =====================================
async function loadDataCuti() {
    const tbody = document.querySelector("#tab-cuti tbody");
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Memuat data...</td></tr>';
    
    const { data, error } = await supabaseClient.from('cuti').select('*, users(nama)').order('tanggal_mulai', { ascending: false });
    
    if (error || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Belum ada pengajuan cuti</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(cuti => {
        let aksiHTML = '';
        if (cuti.status_pengajuan === 'Menunggu') {
            aksiHTML = `
                <button class="btn btn-sm btn-success" onclick="prosesCuti('${cuti.id}', '${cuti.user_id}', ${cuti.durasi_hari}, 'Disetujui')">Setujui</button>
                <button class="btn btn-sm btn-danger" onclick="prosesCuti('${cuti.id}', null, null, 'Ditolak')">Tolak</button>
            `;
        } else {
            aksiHTML = `<span class="badge bg-${cuti.status_pengajuan === 'Disetujui' ? 'success' : 'danger'}">${cuti.status_pengajuan}</span>`;
        }

        tbody.innerHTML += `
            <tr>
                <td>${cuti.users?.nama || 'Unknown'}</td>
                <td>${cuti.tanggal_mulai} s/d ${cuti.tanggal_selesai}</td>
                <td>${cuti.alasan}</td>
                <td>${cuti.durasi_hari} Hari</td>
                <td>${aksiHTML}</td>
            </tr>
        `;
    });
}

async function prosesCuti(cuti_id, user_id, durasi, status) {
    if (!confirm(`Yakin ingin mengubah status menjadi: ${status}?`)) return;
    
    // Update status cuti
    await supabaseClient.from('cuti').update({ status_pengajuan: status }).eq('id', cuti_id);

    // Jika disetujui, potong sisa cuti user
    if (status === 'Disetujui' && user_id) {
        const { data: user } = await supabaseClient.from('users').select('sisa_cuti').eq('id', user_id).single();
        if (user) {
            const sisaBaru = user.sisa_cuti - durasi;
            await supabaseClient.from('users').update({ sisa_cuti: sisaBaru }).eq('id', user_id);
        }
    }
    
    Swal.fire("Berhasil", `Cuti ${status}`, "success");
    loadDataCuti();
    loadDataKaryawan(); // Refresh tabel karyawan agar sisa cutinya terupdate
}

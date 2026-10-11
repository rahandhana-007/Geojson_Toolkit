# GeoJSON Toolkit

Aplikasi web statis/PWA untuk membuat, membaca/mengedit, mengganti nama file GeoJSON, serta melacak posisi polygon BSRE berdasarkan ID. Seluruh pemrosesan berlangsung di browser; tidak ada upload ke backend.

## Fitur

### Maker
- Mengambil titik dengan `navigator.geolocation.getCurrentPosition()` dan `enableHighAccuracy: true`.
- Menyimpan identitas nama lahan dan nama pemilik lahan.
- Tombol **Confirm** mengunci identitas dan menyembunyikan panelnya agar layar fokus pada peta serta pengambilan titik.
- Tombol **My Location** muncul sebelum titik pertama untuk memusatkan peta ke posisi pengguna tanpa memasukkannya ke Capture Log.
- Posisi dari My Location baru tersimpan ketika pengguna menekan **Ambil Titik**; tombol tersebut otomatis hilang setelah titik pertama tersedia.
- Setelah titik GPS pertama direkam, **Live Trail** otomatis memantau pergerakan menggunakan `watchPosition`.
- Jejak aktual ditampilkan sebagai garis titik oranye, lengkap dengan marker panah arah, lingkaran akurasi, jarak tempuh, dan bearing.
- Live Trail dapat dijeda/dilanjutkan dan dibersihkan otomatis saat Reset atau ketika seluruh titik dihapus.
- Indikator kualitas GPS diperbarui secara live: **Sangat Akurat** (≤5 m), **Akurat** (>5–10 m), **Kurang Akurat** (>10–25 m), dan **Bad Signal** (>25 m atau tidak ada GPS fix).
- Klasifikasi akurasi juga ditampilkan pada setiap titik GPS di Capture Log.
- Tombol **Reset** menghapus titik dan membuka kembali panel Identitas Lahan untuk diperiksa atau diubah.
- Tombol **Manual Coordinate** pada Capture Log menerima satu atau banyak baris koordinat decimal degrees melalui paste.
- Mendukung urutan `Latitude, Longitude` maupun `Longitude, Latitude`, dengan pemisah koma, titik koma, spasi, atau tab.
- Marker, garis sementara, dan preview polygon hijau terang langsung di Leaflet.
- Tombol **Load BSRE** untuk menampilkan referensi polygon BSRE berwarna sky blue.
- Titik dapat dihapus satu per satu.
- Menghitung luas geodesik (m²/ha) dan perimeter.
- Export `FeatureCollection` / `Polygon` dengan properties `nama_lahan`, `nama_pemilik`, `luas_hektar`, `tanggal_pembuatan`, dan `jumlah_titik`.

### Reader
- Tampilan utama adalah **Coordinate Sheet**: daftar koordinat semua polygon terbaca langsung di layar, tanpa perlu membuka peta atau editor.
- Dikelompokkan per feature (nomor + nama/ID + tipe + luas + keliling) lalu per cincin: `Cincin luar`, `Lubang 1`, `Poligon 2 · cincin luar`.
- Kolom: nomor titik, Lintang, Bujur, panjang segmen dari titik sebelumnya (meter), dan keterangan (`awal`, `penutup · sama dengan titik 1`, `tinggi … m` untuk geometry 3D).
- Baris titik penutup tetap ditampilkan (abu-abu, bergaris coret) agar jelas bahwa cincin tertutup, bukan dihitung sebagai titik baru.
- Strip ringkasan: jumlah fitur, jumlah polygon, total titik unik, **luas terhitung (ha)**, total keliling, rentang lintang/bujur, dan satuan (WGS84 · decimal degrees).
- **Lubang (inner ring) mengurangi luas**, jadi angka ha sesuai geometri sebenarnya.
- Tombol **6 DESIMAL / PRESISI PENUH** untuk berpindah antara bacaan rapi dan angka persis seperti di file; **DMS** menambah kolom derajat-menit-detik (LU/LS/BT/BU) untuk bacaan ukur.
- Kotak pencarian menyaring berdasarkan ID, nama feature, atau digit koordinat (mis. `98.671`), dengan catatan berapa titik disembunyikan filter.
- Lingkup **Semua / Terpilih** untuk menampilkan seluruh file atau hanya feature yang sedang dipilih.
- **Salin CSV** ke clipboard dan **Unduh CSV** (`namaberkas_koordinat.csv`); tiap baris grup punya **Salin** untuk menyalin `lintang, bujur` satu feature saja.
- Klik baris koordinat = menggeser peta ke titik itu dan membuka popup-nya; tombol **Lihat** pada grup memilih sekaligus men-zoom feature tersebut.
- Saat titik polygon digeser (mode Edit Polygon), tabel koordinat ikut diperbarui seketika.
- File besar diringkas sampai 1.500 baris demi kenyamanan baca, dengan petunjuk memakai Unduh CSV untuk daftar lengkap (CSV selalu berisi seluruh titik).
- Upload lewat drag-and-drop atau file picker.
- Validasi root, feature, geometry, rentang koordinat, dan linear ring.
- Mendukung Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, dan GeometryCollection.
- Geometry dari file yang dimuat ditampilkan dengan garis hijau terang dan fill hijau transparan agar jelas saat di-overlay.
- Tombol **Compare** memuat BSRE sebagai overlay sky blue tanpa mengubah extent file utama.
- Tombol **Hidden BSRE** menyembunyikan overlay pembanding dan dapat ditampilkan kembali tanpa memuat ulang file.
- Selector feature dan editor properties bertipe string, number, boolean, null, atau JSON.
- Menyimpan edit di memory sebelum download.
- **Luas tidak ikut berubah saat titik digeser** — `luas_hektar` di file adalah angka tersimpan, bukan hasil hitung. Sejak ini Reader menanganinya eksplisit:
  - **Coordinate Sheet** selalu menampilkan luas bentuk *saat ini* (diperbarui tiap titik digeser).
  - Panel property punya pengingat **"Luas property belum mengikuti bentuk baru"** yang menyebut angka lama, angka baru, dan selisihnya, dengan tombol **Perbarui Luas**.
  - Centang **"Sinkron luas otomatis"** (bawaan aktif) agar `luas_hektar` dan `luas_m2` langsung ditulis ulang setiap kali titik digeser — hanya untuk key yang sudah ada di file, dan tetap perlu **Simpan Perubahan**/unduh untuk menyimpannya.
  - Saat hanya membaca file (tanpa mode edit) nilai yang tidak cocok **tidak pernah diubah diam-diam**; hanya ditandai.
  - Luas dihitung dari cincin luar **dikurangi lubang**, dan untuk MultiPolygon = jumlah seluruh polygon; sumber angkanya sama dengan yang tampil di tabel koordinat.

### Renamer
- Validasi file sumber.
- Mengganti nama file dengan sanitasi otomatis.
- Opsional menyinkronkan field `nama_lahan`, `name`, atau field custom pada properties.

### Tracker
- Modul keempat untuk melacak posisi polygon BSRE tertentu tanpa harus memuat file apa pun.
- Satu layar peta penuh + text box daftar ID polygon; satu ID per baris (boleh juga dipisahkan koma atau spasi).
- Pencocokan huruf besar/kecil diabaikan, ID duplikat digabungkan, dan maksimal 60 ID diproses per pencarian.
- ID blok tanpa akhiran (mis. `AC00020799`) otomatis ditandai sebagai **BLOK** dan mengambil seluruh sub-polygonnya (`-1`, `-2`, dst.).
- Polygon target digambar merah di atas konteks BSRE, diberi nomor urut sesuai daftar input, popup ID + luas (ha), serta tooltip saat hover.
- Daftar "Polygon Terlacak" menampilkan status tiap ID; klik baris untuk zoom ke polygon tersebut, tombol × menghapusnya dan menyinkronkan text box.
- ID yang tidak ditemukan ditandai merah dan menawarkan chip ID terdekat; klik chip untuk langsung memakai ID tersebut.
- Tombol **Konteks BSRE** menampilkan seluruh 1.212 polygon BSRE sebagai latar abu-abu (tetap dapat dimatikan).
- Tombol **Posisi Saya** memantau GPS (`watchPosition` + `enableHighAccuracy`) dan melaporkan apakah posisi berada di dalam polygon target atau jaraknya ke tepi polygon (meter/kilometer).
- Akurasi GPS memakai label yang sama dengan Maker (Sangat Akurat/Akurat/Kurang Akurat/Bad Signal) dan ditampilkan pada caption peta.
- Pemantauan GPS berhenti otomatis saat tab meninggalkan Tracker, dan bisa dihentikan manual lewat tombol **Berhenti Lacak**.
- Data BSRE dibaca dari `assets/bsre.geojson` yang sudah di-cache service worker, sehingga pelacakan berdasarkan ID tetap berjalan offline (peta memakai grid koordinat).
- Tombol **Set as Destination** (atau ikon bendera di setiap baris daftar) memilih polygon target, lalu langsung menarik **jalur tercepat berwarna biru** dari posisi GPS Anda ke tepi polygon tersebut.
- Estimasi ditampilkan sebagai **jarak dalam km** (2 desimal, format Indonesia), durasi tempuh, dan mode rute (Jalan Raya / Lurus).
- Arahan per belahan (turn-by-turn) berbahasa Indonesia diambil dari langkah rute OSRM, lengkap dengan jarak tiap tahap dan nama jalan bila ada.
- Rute dihitung oleh layanan publik OSRM (`router.project-osrm.org`, tanpa API key, dipanggil langsung dari browser). Saat jaringan/layanan tidak terjangkau, aplikasi otomatis memakai **perkiraan garis lurus** dari GPS ke tepi polygon dan menandainya sebagai estimasi (garis biru putus-putus, durasi tidak dikarang).
- Titik tujuan adalah **titik terdekat di batas polygon** dari posisi Anda; jika Anda sudah berada di dalam polygon, rute tidak dihitung dan dilaporkan `0,00 km`.
- Ada tombol **Perbarui Rute**, tautan **Google Maps** sebagai alternatif navigasi, dan rute diperbarui otomatis setelah Anda bergerak ≥25 m (dibatasi minimal 15 detik antar permintaan agar tidak membanjiri layanan).
- Ikon bendera **TUJUAN** menandai ujung rute di peta; menekan × pada panel tujuan membersihkan garis biru, penanda, dan status baris.
- Tujuan mengikuti polygon yang sama (dicocokkan berdasarkan ID) ketika daftar ditandai ulang; bila ID itu hilang, rute dibersihkan otomatis.

### Progressive Web App
- Dapat diinstal di Android sebagai aplikasi standalone.
- App shell, Leaflet, dan file BSRE tersedia dari cache setelah kunjungan pertama.
- Tombol **Install App** muncul otomatis ketika browser menyatakan aplikasi siap dipasang.
- Shortcut Maker, Reader, Renamer, dan Tracker tersedia dari ikon aplikasi pada Android yang mendukungnya; membuka shortcut cukup mengganti hash dan tab ikut berpindah.
- Basemap OpenStreetMap tetap membutuhkan internet; proses GeoJSON lokal tetap dapat berjalan tanpa basemap.

## Instalasi di Android

1. Buka aplikasi melalui **HTTPS** di Google Chrome.
2. Tekan tombol **Install App** pada header ketika muncul.
3. Konfirmasikan **Install** pada dialog Chrome.
4. GeoJSON Toolkit akan tersedia di layar utama dan app drawer.

Jika tombol belum muncul, buka menu Chrome (⋮), lalu pilih **Install app** atau **Tambahkan ke layar utama**.

## Menjalankan

Karena aplikasi memakai Geolocation API, jalankan melalui `localhost` atau HTTPS (jangan sekadar membuka `file://` bila ingin memakai GPS).

```bash
cd geojson-toolkit
python3 -m http.server 8000
```

Buka `http://localhost:8000`.

Alternatif server statis apa pun dapat digunakan, misalnya:

```bash
npx serve .
```

## Struktur

```text
geojson-toolkit/
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── service-worker.js
├── assets/
│   ├── bsre.geojson
│   ├── favicon.svg
│   └── icons/
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── maskable-512.png
│       └── apple-touch-icon.png
├── vendor/
│   ├── leaflet.css
│   └── leaflet.js
└── README.md
```

Leaflet disimpan lokal di folder `vendor`. Basemap memakai tile OpenStreetMap dan tetap membutuhkan koneksi internet. Jika tile tidak tersedia, geometry lokal masih dapat diproses dan diekspor.

## Privasi

File GeoJSON dan koordinat diproses di sisi client. Aplikasi ini tidak memiliki endpoint backend, analytics, atau mekanisme upload data.

## Mode Offline
Ketika perangkat tidak terhubung ke internet, aplikasi tetap bisa dipakai untuk input koordinat manual:
- App shell (HTML/CSS/JS/Leaflet) di-cache oleh service worker dan dimuat dari cache saat offline.
- Peta dasar OpenStreetMap tidak tersedia saat offline, sehingga aplikasi otomatis menggantinya dengan **grid koordinat (garis lintang/bujur)** agar titik & polygon tetap terlihat.
- Indikator **OFFLINE · GRID MODE** muncul pada panel peta, dan tombol "Mode Offline · Grid" ditandai.
- Input Koordinat Manual, penambahan titik, perhitungan luas, dan unduh GeoJSON semuanya berjalan tanpa koneksi.
- Modul Tracker memakai `assets/bsre.geojson` dari cache service worker, sehingga pencarian ID polygon dan penandaannya tetap berfungsi offline; hanya tile peta yang bergantung pada jaringan.

## Edit Polygon (Reader · dilindungi PIN)
Fitur untuk mengubah bentuk geometry Polygon/MultiPolygon yang telah di-load di tab **Reader** dengan menyeret titik-titiknya.
- Tombol **"Edit · Locked"** menampilkan dialog PIN. Masukkan PIN **`663322`** untuk membuka fitur.
- Setelah terbuka, tombol **"Edit Polygon"** muncul. Klik untuk masuk mode edit: setiap sudut polygon diberi marker merah yang dapat diseret.
- Saat menyeret, bentuk polygon diperbarui secara langsung; hasilnya tersimpan di memory browser (status menjadi "BELUM DISIMPAN").
- Klik lagi **"Selesai Edit"** untuk keluar dan menyegarkan tampilan peta dari geometry terbaru.
- Hanya geometry bertipe `Polygon` / `MultiPolygon` yang dapat diedit. Selama mode edit aktif, pemilihan feature lain dan ganti file dibatasi.
- Unduh hasil edit via panel **Download Hasil Edit** setelah menyimpan perubahan.

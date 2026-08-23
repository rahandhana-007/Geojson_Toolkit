# GeoJSON Toolkit

Aplikasi web statis/PWA untuk membuat, membaca/mengedit, dan mengganti nama file GeoJSON. Seluruh pemrosesan file berlangsung di browser; tidak ada upload ke backend.

## Fitur

### Maker
- Mengambil titik dengan `navigator.geolocation.getCurrentPosition()` dan `enableHighAccuracy: true`.
- Menyimpan identitas nama lahan dan nama pemilik lahan.
- Tombol **Confirm** mengunci identitas dan menyembunyikan panelnya agar layar fokus pada peta serta pengambilan titik.
- Tombol **Reset** menghapus titik dan membuka kembali panel Identitas Lahan untuk diperiksa atau diubah.
- Tombol **Manual Coordinate** pada Capture Log menerima satu atau banyak baris koordinat decimal degrees melalui paste.
- Mendukung urutan `Latitude, Longitude` maupun `Longitude, Latitude`, dengan pemisah koma, titik koma, spasi, atau tab.
- Marker, garis sementara, dan preview polygon hijau terang langsung di Leaflet.
- Tombol **Load BSRE** untuk menampilkan referensi polygon BSRE berwarna sky blue.
- Titik dapat dihapus satu per satu.
- Menghitung luas geodesik (m²/ha) dan perimeter.
- Export `FeatureCollection` / `Polygon` dengan properties `nama_lahan`, `nama_pemilik`, `luas_m2`, `luas_hektar`, `tanggal_pembuatan`, dan `jumlah_titik`.

### Reader
- Upload lewat drag-and-drop atau file picker.
- Validasi root, feature, geometry, rentang koordinat, dan linear ring.
- Mendukung Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, dan GeometryCollection.
- Geometry dari file yang dimuat ditampilkan dengan garis hijau terang dan fill hijau transparan agar jelas saat di-overlay.
- Tombol **Compare** memuat BSRE sebagai overlay sky blue tanpa mengubah extent file utama.
- Tombol **Hidden BSRE** menyembunyikan overlay pembanding dan dapat ditampilkan kembali tanpa memuat ulang file.
- Selector feature dan editor properties bertipe string, number, boolean, null, atau JSON.
- Menyimpan edit di memory sebelum download.

### Renamer
- Validasi file sumber.
- Mengganti nama file dengan sanitasi otomatis.
- Opsional menyinkronkan field `nama_lahan`, `name`, atau field custom pada properties.

### Progressive Web App
- Dapat diinstal di Android sebagai aplikasi standalone.
- App shell, Leaflet, dan file BSRE tersedia dari cache setelah kunjungan pertama.
- Tombol **Install App** muncul otomatis ketika browser menyatakan aplikasi siap dipasang.
- Shortcut Maker, Reader, dan Renamer tersedia dari ikon aplikasi pada Android yang mendukungnya.
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

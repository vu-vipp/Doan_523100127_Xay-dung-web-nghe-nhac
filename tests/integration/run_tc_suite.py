import json
import os
import re
import sys
import time
from pathlib import Path

import pymysql
import requests

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
RESULT_DIR = ROOT / "test-results"
TXT_FILE = RESULT_DIR / "test_results.txt"
JSON_FILE = RESULT_DIR / "test_results_summary.json"

BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:3000").rstrip("/")
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "wave_music_mvc"),
    "charset": "utf8mb4",
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor,
}
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@wave.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "IntegrationAdmin123!")
RUN_ID = str(int(time.time()))
PASSWORD = "Password123!"
PREFIX = f"itest_{RUN_ID}"

results = {}
created_user_ids = []
created_artist_names = set()
uploaded_audio = None
uploaded_cover = None
uploaded_song_id = None


def db():
    return pymysql.connect(**DB_CONFIG)


def query_one(sql, args=()):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()
    finally:
        conn.close()


def query_all(sql, args=()):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()
    finally:
        conn.close()


def execute(sql, args=()):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.lastrowid, cur.rowcount
    finally:
        conn.close()


def ensure(condition, message):
    if not condition:
        raise AssertionError(message)


def status_text(response):
    reason = response.reason or ""
    return f"HTTP {response.status_code} {reason}".strip()


def get_csrf(session, path):
    response = session.get(BASE_URL + path, timeout=15)
    ensure(response.status_code == 200, f"GET {path} trả {response.status_code}")
    match = re.search(r'name="_csrf"\s+value="([^"]+)"', response.text)
    ensure(match is not None, f"Không tìm thấy CSRF token ở {path}")
    return match.group(1)


def register_user(label):
    session = requests.Session()
    email = f"{PREFIX}_{label}@wave.local"
    token = get_csrf(session, "/register")
    response = session.post(
        BASE_URL + "/register",
        data={
            "_csrf": token,
            "name": f"Integration {label}",
            "email": email,
            "password": PASSWORD,
        },
        allow_redirects=False,
        timeout=15,
    )
    ensure(response.status_code == 302, f"Đăng ký {email} không redirect: {response.status_code}")
    ensure(response.headers.get("Location") == "/login", f"Đăng ký {email} redirect sai")
    row = query_one("SELECT MaNguoiDung FROM NguoiDung WHERE Email=%s", (email,))
    ensure(row is not None, f"Không tìm thấy user vừa đăng ký: {email}")
    user_id = int(row["MaNguoiDung"])
    created_user_ids.append(user_id)
    return {"id": user_id, "email": email, "password": PASSWORD}


def login(email, password):
    session = requests.Session()
    token = get_csrf(session, "/login")
    response = session.post(
        BASE_URL + "/login",
        data={"_csrf": token, "email": email, "password": password},
        allow_redirects=False,
        timeout=15,
    )
    return session, response


def admin_session():
    session, response = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    ensure(response.status_code == 302, f"Admin login trả {response.status_code}")
    ensure(response.headers.get("Location") == "/admin", "Admin không được chuyển tới /admin")
    return session


def record(tc_id, name, input_text, expected, fn):
    try:
        status, result = fn()
        results[tc_id] = {
            "name": name,
            "input": input_text,
            "expected": expected,
            "actual": f"{status}. {result}",
            "status": "PASS",
            "_http_status": status,
            "_result": result,
        }
        print(f"PASS {tc_id} - {name}")
    except Exception as exc:
        results[tc_id] = {
            "name": name,
            "input": input_text,
            "expected": expected,
            "actual": f"ERROR. {exc}",
            "status": "FAIL",
            "_http_status": "ERROR",
            "_result": str(exc),
        }
        print(f"FAIL {tc_id} - {name}: {exc}")


def write_reports():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)

    json_output = {}
    for tc_id, item in results.items():
        json_output[tc_id] = {
            "name": item["name"],
            "input": item["input"],
            "expected": item["expected"],
            "actual": item["actual"],
            "status": item["status"],
        }
    JSON_FILE.write_text(
        json.dumps(json_output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    lines = [
        "============================================================",
        "BÁO CÁO KIỂM THỬ TÍCH HỢP THỰC TẾ - WAVE MUSIC",
        f"Base URL: {BASE_URL}",
        "============================================================",
        "",
    ]
    for tc_id, item in results.items():
        lines.extend(
            [
                f"{tc_id} ({item['name']}):",
                f"   - Input: {item['input']}",
                f"   - Status: {item['_http_status']}",
                f"   - Result: {item['_result']}",
                f"   - Trạng thái: {item['status']}",
                "",
            ]
        )
    TXT_FILE.write_text("\n".join(lines), encoding="utf-8")


def build_mp3_bytes(frame_count=100):
    # MPEG1 Layer III, 128 kbps, 44.1 kHz. Mỗi frame dài 417 bytes.
    frame = bytearray(417)
    frame[0:4] = bytes([0xFF, 0xFB, 0x90, 0x64])
    return bytes(frame) * frame_count


def cleanup():
    global uploaded_audio, uploaded_cover
    if not created_user_ids and not uploaded_song_id:
        return

    conn = db()
    try:
        with conn.cursor() as cur:
            if created_user_ids:
                placeholders = ",".join(["%s"] * len(created_user_ids))
                cur.execute(
                    f"""DELETE ct FROM ChiTietPlaylist ct
                        JOIN Playlist p ON p.MaPlaylist=ct.MaPlaylist
                        WHERE p.MaNguoiDung IN ({placeholders})""",
                    created_user_ids,
                )
                cur.execute(
                    f"DELETE FROM Playlist WHERE MaNguoiDung IN ({placeholders})",
                    created_user_ids,
                )
                cur.execute(
                    f"DELETE FROM DangKyVIP WHERE MaNguoiDung IN ({placeholders})",
                    created_user_ids,
                )

            if uploaded_song_id:
                cur.execute("DELETE FROM ChiTietPlaylist WHERE MaBaiHat=%s", (uploaded_song_id,))
                cur.execute("DELETE FROM BaiHat WHERE MaBaiHat=%s", (uploaded_song_id,))

            if created_artist_names:
                for name in created_artist_names:
                    cur.execute(
                        """DELETE c FROM CaSi c
                           LEFT JOIN BaiHat b ON b.MaCaSi=c.MaCaSi
                           LEFT JOIN Album a ON a.MaCaSi=c.MaCaSi
                           WHERE c.TenCaSi=%s AND b.MaBaiHat IS NULL AND a.MaAlbum IS NULL""",
                        (name,),
                    )

            if created_user_ids:
                cur.execute(
                    f"DELETE FROM NguoiDung WHERE MaNguoiDung IN ({placeholders})",
                    created_user_ids,
                )
    finally:
        conn.close()

    if uploaded_audio:
        (ROOT / "storage" / "audio" / uploaded_audio).unlink(missing_ok=True)
    if uploaded_cover:
        rel = uploaded_cover.replace("/static/", "")
        (ROOT / "public" / rel).unlink(missing_ok=True)


def main():
    global uploaded_audio, uploaded_cover, uploaded_song_id

    health = requests.get(BASE_URL + "/", timeout=15)
    ensure(health.status_code == 200, f"Server chưa sẵn sàng: {health.status_code}")

    free_song = query_one(
        "SELECT MaBaiHat,TenBaiHat FROM BaiHat WHERE IsVIP=0 AND TrangThai=1 ORDER BY MaBaiHat LIMIT 1"
    )
    vip_song = query_one(
        "SELECT MaBaiHat,TenBaiHat FROM BaiHat WHERE IsVIP=1 AND TrangThai=1 ORDER BY MaBaiHat LIMIT 1"
    )
    trial_plan = query_one(
        "SELECT MaGoi,TenGoi FROM GoiVIP WHERE Gia=0 AND ThoiHan=1 ORDER BY MaGoi LIMIT 1"
    )
    paid_plan = query_one(
        "SELECT MaGoi,TenGoi,ThoiHan,Gia FROM GoiVIP WHERE Gia>0 ORDER BY ThoiHan LIMIT 1"
    )
    genre = query_one("SELECT MaTheLoai,TenTheLoai FROM TheLoai ORDER BY MaTheLoai LIMIT 1")

    ensure(free_song and vip_song and trial_plan and paid_plan and genre, "Seed dữ liệu chưa đầy đủ")

    user_free = register_user("free")
    user_vip = register_user("vip")
    user_history = register_user("history")
    user_approve = register_user("approve")
    user_paid = register_user("paid")
    user_lock = register_user("lock")

    free_session, free_login = login(user_free["email"], user_free["password"])
    ensure(free_login.status_code == 302 and free_login.headers.get("Location") == "/", "Login user_free thất bại")

    vip_session, vip_login = login(user_vip["email"], user_vip["password"])
    ensure(vip_login.status_code == 302 and vip_login.headers.get("Location") == "/", "Login user_vip thất bại")

    history_session, history_login = login(user_history["email"], user_history["password"])
    ensure(history_login.status_code == 302, "Login user_history thất bại")

    paid_session, paid_login = login(user_paid["email"], user_paid["password"])
    ensure(paid_login.status_code == 302, "Login user_paid thất bại")

    # Setup state chỉ phục vụ tiền điều kiện cho các test.
    execute(
        """INSERT INTO DangKyVIP(MaNguoiDung,MaGoi,NgayBatDau,NgayKetThuc,TrangThai)
           VALUES(%s,%s,NOW(),DATE_ADD(NOW(), INTERVAL 2 DAY),'DA_XAC_NHAN')""",
        (user_vip["id"], paid_plan["MaGoi"]),
    )
    execute("UPDATE NguoiDung SET TrangThaiVIP=1 WHERE MaNguoiDung=%s", (user_vip["id"],))

    execute(
        """INSERT INTO DangKyVIP(MaNguoiDung,MaGoi,NgayBatDau,NgayKetThuc,TrangThai)
           VALUES(%s,%s,DATE_SUB(NOW(), INTERVAL 2 DAY),DATE_SUB(NOW(), INTERVAL 1 DAY),'HUY')""",
        (user_history["id"], trial_plan["MaGoi"]),
    )

    approve_registration_id, _ = execute(
        """INSERT INTO DangKyVIP(MaNguoiDung,MaGoi,NgayBatDau,NgayKetThuc,TrangThai)
           VALUES(%s,%s,NOW(),DATE_ADD(NOW(), INTERVAL %s DAY),'CHO_XAC_NHAN')""",
        (user_approve["id"], paid_plan["MaGoi"], int(paid_plan["ThoiHan"])),
    )

    admin = admin_session()

    record(
        "TC01",
        "Tài khoản thường nghe bài FREE",
        f"user='{user_free['email']}', songId={free_song['MaBaiHat']}, IsVIP=0, Range='bytes=0-15'",
        "Bài hát FREE phát bình thường.",
        lambda: tc01_free_stream(free_session, free_song),
    )

    record(
        "TC02",
        "Tài khoản thường chọn bài VIP",
        f"user='{user_free['email']}', songId={vip_song['MaBaiHat']}, IsVIP=1, activeVIP=None",
        "Không cấp audio; yêu cầu đăng ký VIP.",
        lambda: tc02_vip_denied(free_session, vip_song),
    )

    record(
        "TC03",
        "Tài khoản VIP còn hạn chọn bài VIP",
        f"user='{user_vip['email']}', songId={vip_song['MaBaiHat']}, activeVIP=DA_XAC_NHAN",
        "Bài hát VIP phát thành công.",
        lambda: tc03_vip_stream(vip_session, vip_song),
    )

    playlist_name = f"{PREFIX}_playlist"
    playlist_id_holder = {}

    def tc04():
        token = get_csrf(free_session, "/playlists")
        response = free_session.post(
            BASE_URL + "/playlists",
            data={"_csrf": token, "name": playlist_name},
            allow_redirects=False,
            timeout=15,
        )
        ensure(response.status_code == 302, "Tạo playlist không redirect")
        row = query_one(
            "SELECT MaPlaylist FROM Playlist WHERE MaNguoiDung=%s AND TenPlaylist=%s ORDER BY MaPlaylist DESC LIMIT 1",
            (user_free["id"], playlist_name),
        )
        ensure(row is not None, "Không tìm thấy playlist vừa tạo")
        playlist_id = int(row["MaPlaylist"])
        playlist_id_holder["id"] = playlist_id

        token = get_csrf(free_session, f"/songs/{free_song['MaBaiHat']}")
        add_response = free_session.post(
            BASE_URL + f"/songs/{free_song['MaBaiHat']}/playlist",
            data={"_csrf": token, "playlistId": playlist_id},
            allow_redirects=False,
            timeout=15,
        )
        ensure(add_response.status_code == 302, "Thêm playlist không redirect")
        count = query_one(
            "SELECT COUNT(*) AS n FROM ChiTietPlaylist WHERE MaPlaylist=%s AND MaBaiHat=%s",
            (playlist_id, free_song["MaBaiHat"]),
        )
        ensure(int(count["n"]) == 1, "Bài hát không được thêm đúng playlist")
        return status_text(add_response), f"Bài hát được thêm vào playlistId={playlist_id}; CSDL có đúng 1 bản ghi ChiTietPlaylist."

    record(
        "TC04",
        "Thêm bài hát vào playlist thuộc tài khoản",
        f"userId={user_free['id']}, songId={free_song['MaBaiHat']}, playlist='{playlist_name}'",
        "Bài được thêm đúng playlist.",
        tc04,
    )

    def tc05():
        playlist_id = playlist_id_holder.get("id")
        ensure(playlist_id, "TC04 chưa tạo playlist")
        token = get_csrf(free_session, f"/songs/{free_song['MaBaiHat']}")
        response = free_session.post(
            BASE_URL + f"/songs/{free_song['MaBaiHat']}/playlist",
            data={"_csrf": token, "playlistId": playlist_id},
            allow_redirects=False,
            timeout=15,
        )
        count = query_one(
            "SELECT COUNT(*) AS n FROM ChiTietPlaylist WHERE MaPlaylist=%s AND MaBaiHat=%s",
            (playlist_id, free_song["MaBaiHat"]),
        )
        ensure(int(count["n"]) == 1, "Đã tạo bản ghi playlist trùng")
        page = free_session.get(BASE_URL + response.headers.get("Location", "/"), timeout=15)
        ensure("đã có trong playlist" in page.text.lower(), "Không có thông báo thêm trùng")
        return status_text(response), "Hệ thống không tạo bản ghi trùng và hiển thị thông báo bài hát đã có trong playlist."

    record(
        "TC05",
        "Thêm lại bài đã có trong cùng playlist",
        f"playlistId={playlist_id_holder.get('id')}, songId={free_song['MaBaiHat']} đã tồn tại",
        "Không tạo bản ghi trùng.",
        tc05,
    )

    def tc06():
        token = get_csrf(admin, "/admin")
        response = admin.post(
            BASE_URL + f"/admin/vip/{approve_registration_id}/approve",
            data={"_csrf": token},
            allow_redirects=False,
            timeout=15,
        )
        ensure(response.status_code == 302, "Duyệt VIP không redirect")
        row = query_one(
            "SELECT TrangThai,NgayBatDau,NgayKetThuc FROM DangKyVIP WHERE MaDangKy=%s",
            (approve_registration_id,),
        )
        user_row = query_one(
            "SELECT TrangThaiVIP FROM NguoiDung WHERE MaNguoiDung=%s",
            (user_approve["id"],),
        )
        ensure(row["TrangThai"] == "DA_XAC_NHAN", "DangKyVIP chưa DA_XAC_NHAN")
        ensure(int(user_row["TrangThaiVIP"]) == 1, "TrangThaiVIP chưa bật")
        return status_text(response), "Admin duyệt thành công: DangKyVIP=DA_XAC_NHAN và TrangThaiVIP=1."

    record(
        "TC06",
        "Admin xác nhận yêu cầu VIP đang chờ",
        f"registrationId={approve_registration_id}, action=approve",
        "Đăng ký chuyển DA_XAC_NHAN và có quyền VIP.",
        tc06,
    )

    song_name = f"{PREFIX}_song"
    artist_name = f"{PREFIX}_artist"
    created_artist_names.add(artist_name)

    def tc07():
        nonlocal song_name, artist_name
        global uploaded_audio, uploaded_cover, uploaded_song_id
        token = get_csrf(admin, "/admin/songs/new")
        response = admin.post(
            BASE_URL + "/admin/songs",
            data={
                "_csrf": token,
                "name": song_name,
                "artistName": artist_name,
                "genreId": str(genre["MaTheLoai"]),
                "albumId": "",
                "isVIP": "0",
            },
            files={
                "audioFile": ("integration.mp3", build_mp3_bytes(), "audio/mpeg"),
                "coverFile": ("integration.jpg", bytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00]), "image/jpeg"),
            },
            allow_redirects=False,
            timeout=20,
        )
        ensure(response.status_code == 302 and response.headers.get("Location") == "/admin", "Upload hợp lệ thất bại")
        row = query_one(
            "SELECT MaBaiHat,ThoiLuong,DuongDanAudio,AnhBia FROM BaiHat WHERE TenBaiHat=%s ORDER BY MaBaiHat DESC LIMIT 1",
            (song_name,),
        )
        ensure(row is not None, "Bài hát upload không được lưu")
        ensure(int(row["ThoiLuong"]) > 0, "ThoiLuong không được đọc từ audio")
        uploaded_song_id = int(row["MaBaiHat"])
        uploaded_audio = row["DuongDanAudio"]
        uploaded_cover = row["AnhBia"]
        return status_text(response), f"Lưu bài hát thành công; ThoiLuong={row['ThoiLuong']} giây được lấy từ audio."

    record(
        "TC07",
        "Admin upload audio/cover hợp lệ",
        f"name='{song_name}', artistName='{artist_name}', genreId={genre['MaTheLoai']}, audio=.mp3, cover=.jpg",
        "Bài hát được lưu; ThoiLuong lấy từ audio.",
        tc07,
    )

    invalid_name = f"{PREFIX}_invalid_song"

    def tc08():
        token = get_csrf(admin, "/admin/songs/new")
        response = admin.post(
            BASE_URL + "/admin/songs",
            data={
                "_csrf": token,
                "name": invalid_name,
                "artistName": artist_name,
                "genreId": str(genre["MaTheLoai"]),
                "albumId": "",
                "isVIP": "0",
            },
            files={
                "audioFile": ("malware.exe", b"not-an-audio-file", "application/octet-stream"),
            },
            allow_redirects=False,
            timeout=15,
        )
        ensure(response.status_code == 302, "File sai định dạng không được redirect")
        row = query_one("SELECT MaBaiHat FROM BaiHat WHERE TenBaiHat=%s", (invalid_name,))
        ensure(row is None, "File sai định dạng vẫn tạo BaiHat")
        page = admin.get(BASE_URL + response.headers.get("Location", "/admin/songs/new"), timeout=15)
        ensure("Chỉ nhận file nhạc .mp3 hoặc .aac hợp lệ." in page.text, "Không thấy thông báo sai định dạng")
        return status_text(response), "Hệ thống từ chối file .exe và hiển thị lỗi chỉ nhận .mp3 hoặc .aac hợp lệ."

    record(
        "TC08",
        "Admin upload audio/ảnh sai định dạng",
        "audioFile='malware.exe', mimetype='application/octet-stream'",
        "Hệ thống từ chối và thông báo lỗi.",
        tc08,
    )

    def tc09():
        ensure(uploaded_song_id is not None, "TC07 chưa tạo bài hát")
        token = get_csrf(admin, "/admin")
        response = admin.post(
            BASE_URL + f"/admin/songs/{uploaded_song_id}/delete",
            data={"_csrf": token},
            allow_redirects=False,
            timeout=15,
        )
        row = query_one("SELECT TrangThai FROM BaiHat WHERE MaBaiHat=%s", (uploaded_song_id,))
        ensure(int(row["TrangThai"]) == 0, "TrangThai chưa bằng 0")
        user_view = free_session.get(BASE_URL + f"/songs/{uploaded_song_id}", timeout=15)
        ensure(user_view.status_code == 404, "User vẫn xem được bài đã khóa")
        return f"{status_text(response)}; GET User -> HTTP 404 Not Found", "Soft Delete đặt TrangThai=0 và bài không còn hiển thị cho User."

    record(
        "TC09",
        "Admin khóa/ẩn bài đang hoạt động",
        f"songId={uploaded_song_id or 'TC07'}, TrangThai=1",
        "TrangThai=0; bài không hiển thị cho User.",
        tc09,
    )

    def tc10():
        token = get_csrf(admin, "/admin")
        response = admin.post(
            BASE_URL + f"/admin/songs/{uploaded_song_id}/restore",
            data={"_csrf": token},
            allow_redirects=False,
            timeout=15,
        )
        row = query_one("SELECT TrangThai FROM BaiHat WHERE MaBaiHat=%s", (uploaded_song_id,))
        ensure(int(row["TrangThai"]) == 1, "TrangThai chưa bằng 1")
        user_view = free_session.get(BASE_URL + f"/songs/{uploaded_song_id}", timeout=15)
        ensure(user_view.status_code == 200, "User chưa xem lại được bài đã restore")
        return f"{status_text(response)}; GET User -> HTTP 200 OK", "Khôi phục đặt TrangThai=1 và bài hoạt động lại."

    record(
        "TC10",
        "Admin mở khóa bài hát đã ẩn",
        f"songId={uploaded_song_id or 'TC07'}, TrangThai=0",
        "TrangThai=1; bài hoạt động lại.",
        tc10,
    )

    def tc11():
        response = free_session.get(BASE_URL + "/vip", timeout=15)
        marker = f'name="planId" value="{trial_plan["MaGoi"]}"'
        ensure(response.status_code == 200, "Trang VIP không trả 200")
        ensure(marker in response.text, "Không thấy form gói FREE 1 ngày")
        return status_text(response), "Trang VIP hiển thị form gói Trải nghiệm FREE 1 ngày cho tài khoản chưa từng đăng ký VIP."

    record(
        "TC11",
        "User chưa từng đăng ký VIP mở trang VIP",
        f"user='{user_free['email']}', lịch sử DangKyVIP=không có",
        "Hiển thị gói Trải nghiệm FREE 1 ngày.",
        tc11,
    )

    def tc12():
        response = history_session.get(BASE_URL + "/vip", timeout=15)
        marker = f'name="planId" value="{trial_plan["MaGoi"]}"'
        ensure(response.status_code == 200, "Trang VIP không trả 200")
        ensure(marker not in response.text, "Gói FREE 1 ngày vẫn còn trong danh sách plan")
        return status_text(response), "Không còn form đăng ký gói FREE 1 ngày vì tài khoản đã có lịch sử DangKyVIP."

    record(
        "TC12",
        "User đã từng có DangKyVIP mở trang VIP",
        f"user='{user_history['email']}', lịch sử DangKyVIP=đã tồn tại",
        "Không còn hiển thị gói FREE 1 ngày.",
        tc12,
    )

    def tc13():
        token = get_csrf(free_session, "/vip")
        response = free_session.post(
            BASE_URL + "/vip/subscribe",
            data={"_csrf": token, "planId": str(trial_plan["MaGoi"])},
            allow_redirects=False,
            timeout=15,
        )
        ensure(response.status_code == 302, "Nhận FREE không redirect")
        row = query_one(
            """SELECT TrangThai,TIMESTAMPDIFF(HOUR,NgayBatDau,NgayKetThuc) AS hours
               FROM DangKyVIP WHERE MaNguoiDung=%s ORDER BY MaDangKy DESC LIMIT 1""",
            (user_free["id"],),
        )
        user_row = query_one("SELECT TrangThaiVIP FROM NguoiDung WHERE MaNguoiDung=%s", (user_free["id"],))
        ensure(row and row["TrangThai"] == "DA_XAC_NHAN", "Trial chưa DA_XAC_NHAN")
        ensure(23 <= int(row["hours"]) <= 24, "Trial không có thời hạn xấp xỉ 1 ngày")
        ensure(int(user_row["TrangThaiVIP"]) == 1, "TrangThaiVIP chưa bật")
        return status_text(response), "Tạo DangKyVIP=DA_XAC_NHAN, thời hạn 1 ngày và kích hoạt VIP ngay."

    record(
        "TC13",
        "User nhận gói FREE 1 ngày",
        f"userId={user_free['id']}, planId={trial_plan['MaGoi']}",
        "Tạo DA_XAC_NHAN, thời hạn 1 ngày và có quyền VIP ngay.",
        tc13,
    )

    def tc14():
        token = get_csrf(paid_session, "/vip")
        choose = paid_session.post(
            BASE_URL + "/vip/subscribe",
            data={"_csrf": token, "planId": str(paid_plan["MaGoi"])},
            allow_redirects=False,
            timeout=15,
        )
        ensure(choose.status_code == 302 and choose.headers.get("Location") == "/vip/payment", "Không chuyển tới payment")
        token = get_csrf(paid_session, "/vip/payment")
        confirm = paid_session.post(
            BASE_URL + "/vip/payment/confirm",
            data={"_csrf": token, "paymentMethod": "BANK_TRANSFER"},
            allow_redirects=False,
            timeout=15,
        )
        ensure(confirm.status_code == 302, "Xác nhận payment không redirect")
        row = query_one(
            "SELECT TrangThai,MaGoi FROM DangKyVIP WHERE MaNguoiDung=%s ORDER BY MaDangKy DESC LIMIT 1",
            (user_paid["id"],),
        )
        ensure(row and row["TrangThai"] == "CHO_XAC_NHAN", "Không tạo CHO_XAC_NHAN")
        return f"{status_text(choose)} -> /vip/payment; {status_text(confirm)}", "Sau thanh toán mô phỏng, hệ thống tạo yêu cầu VIP CHO_XAC_NHAN."

    record(
        "TC14",
        "User chọn VIP trả phí và xác nhận thanh toán mô phỏng",
        f"user='{user_paid['email']}', planId={paid_plan['MaGoi']}, paymentMethod=BANK_TRANSFER",
        "Tạo yêu cầu CHO_XAC_NHAN.",
        tc14,
    )

    def tc15():
        token = get_csrf(admin, "/admin/users")
        lock_response = admin.post(
            BASE_URL + f"/admin/users/{user_lock['id']}/lock",
            data={"_csrf": token, "reason": "Vi phạm quy định kiểm thử"},
            allow_redirects=False,
            timeout=15,
        )
        row = query_one(
            "SELECT TrangThai,LyDoKhoa FROM NguoiDung WHERE MaNguoiDung=%s",
            (user_lock["id"],),
        )
        ensure(int(row["TrangThai"]) == 0, "User chưa bị khóa")
        ensure(row["LyDoKhoa"] == "Vi phạm quy định kiểm thử", "LyDoKhoa sai")
        session, login_response = login(user_lock["email"], user_lock["password"])
        ensure(login_response.status_code == 302 and login_response.headers.get("Location") == "/login", "User khóa vẫn login được")
        page = session.get(BASE_URL + "/login", timeout=15)
        ensure("Tài khoản đã bị khóa." in page.text, "Không hiện thông báo tài khoản bị khóa")
        ensure("Vi phạm quy định kiểm thử" in page.text, "Không hiện lý do khóa")
        return f"{status_text(lock_response)}; login -> {status_text(login_response)}", "TrangThai=0, lưu LyDoKhoa và hệ thống từ chối đăng nhập với đúng lý do."

    record(
        "TC15",
        "Admin khóa USER và nhập lý do hợp lệ",
        f"userId={user_lock['id']}, reason='Vi phạm quy định kiểm thử'",
        "TrangThai=0, lưu LyDoKhoa; user bị từ chối đăng nhập.",
        tc15,
    )

    def tc16():
        token = get_csrf(admin, "/admin/users")
        unlock_response = admin.post(
            BASE_URL + f"/admin/users/{user_lock['id']}/unlock",
            data={"_csrf": token},
            allow_redirects=False,
            timeout=15,
        )
        row = query_one(
            "SELECT TrangThai,LyDoKhoa FROM NguoiDung WHERE MaNguoiDung=%s",
            (user_lock["id"],),
        )
        ensure(int(row["TrangThai"]) == 1, "User chưa mở khóa")
        ensure(row["LyDoKhoa"] is None, "LyDoKhoa chưa NULL")
        session, login_response = login(user_lock["email"], user_lock["password"])
        ensure(login_response.status_code == 302 and login_response.headers.get("Location") == "/", "User chưa login lại được")
        home = session.get(BASE_URL + "/", timeout=15)
        ensure(home.status_code == 200, "Trang chủ sau login không trả 200")
        return f"{status_text(unlock_response)}; login -> {status_text(login_response)}; GET / -> HTTP 200 OK", "TrangThai=1, LyDoKhoa=NULL và user đăng nhập lại thành công."

    record(
        "TC16",
        "Admin mở khóa USER",
        f"userId={user_lock['id']}",
        "TrangThai=1, LyDoKhoa=NULL; đăng nhập lại được.",
        tc16,
    )


def tc01_free_stream(session, free_song):
    response = session.get(
        BASE_URL + f"/songs/{free_song['MaBaiHat']}/stream",
        headers={"Range": "bytes=0-15"},
        timeout=15,
    )
    ensure(response.status_code == 206, f"FREE stream trả {response.status_code}")
    ensure(len(response.content) == 16, f"FREE stream trả {len(response.content)} bytes")
    return status_text(response), f"Server trả 16 byte audio cho bài FREE '{free_song['TenBaiHat']}'."


def tc02_vip_denied(session, vip_song):
    response = session.get(
        BASE_URL + f"/songs/{vip_song['MaBaiHat']}/stream",
        timeout=15,
    )
    ensure(response.status_code == 403, f"VIP không quyền trả {response.status_code}")
    body = response.json()
    ensure("VIP" in body.get("error", ""), "Response không có thông báo yêu cầu VIP")
    return status_text(response), f"Server từ chối audio: \"{body['error']}\""


def tc03_vip_stream(session, vip_song):
    response = session.get(
        BASE_URL + f"/songs/{vip_song['MaBaiHat']}/stream",
        headers={"Range": "bytes=0-15"},
        timeout=15,
    )
    ensure(response.status_code == 206, f"VIP stream trả {response.status_code}")
    ensure(len(response.content) == 16, "VIP stream không trả 16 byte")
    return status_text(response), f"Server xác nhận quyền VIP và stream bài '{vip_song['TenBaiHat']}' thành công."


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        results["FATAL"] = {
            "name": "Lỗi khởi tạo bộ integration test",
            "input": "N/A",
            "expected": "Server, DB và dữ liệu seed sẵn sàng.",
            "actual": f"ERROR. {exc}",
            "status": "FAIL",
            "_http_status": "ERROR",
            "_result": str(exc),
        }
        print(f"FATAL: {exc}")
    finally:
        try:
            write_reports()
        finally:
            try:
                cleanup()
            except Exception as cleanup_error:
                print(f"Cleanup warning: {cleanup_error}")

    failures = [item for item in results.values() if item["status"] != "PASS"]
    print(f"RESULT: {len(results) - len(failures)}/{len(results)} test case PASS")
    print(f"TXT: {TXT_FILE.relative_to(ROOT)}")
    print(f"JSON: {JSON_FILE.relative_to(ROOT)}")
    sys.exit(1 if failures else 0)

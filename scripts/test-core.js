const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Writable } = require('node:stream');
const { finished } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');
const resultDir = path.join(root, 'test-results');
const summaryFile = path.join(resultDir, 'unit_test_results_summary.json');
const textFile = path.join(resultDir, 'unit_test_results.txt');

const fakeDb = {
  query: async () => [[]],
  execute: async () => [[]],
  getConnection: async () => { throw new Error('getConnection mock not configured'); }
};

const dbPath = require.resolve('../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const Song = require('../models/SongModel');
const Playlist = require('../models/PlaylistModel');
const User = require('../models/UserModel');
const VIP = require('../models/VIPModel');
const SongController = require('../controllers/SongController');
const AdminController = require('../controllers/AdminController');
const AuthController = require('../controllers/AuthController');

const results = {};

async function test(id, name, input, expected, fn) {
  try {
    const actual = await fn();
    results[id] = {
      name,
      input,
      expected,
      status: actual.status,
      result: actual.result,
      test_status: 'PASS'
    };
    console.log('PASS ' + id + ' - ' + name);
  } catch (error) {
    results[id] = {
      name,
      input,
      expected,
      status: 'ERROR',
      result: 'Lỗi khi chạy test: ' + error.message,
      test_status: 'FAIL'
    };
    console.error('FAIL ' + id + ' - ' + name);
    console.error(error);
  }
}

function makeRes() {
  return {
    redirectUrl: null,
    statusCode: 200,
    body: null,
    headers: {},
    headersSent: false,
    redirect(url) { this.statusCode = 302; this.redirectUrl = url; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    render(view, props) { this.view = view; this.props = props; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
    set(name, value) {
      if (typeof name === 'object') Object.assign(this.headers, name);
      else this.headers[name] = value;
      return this;
    }
  };
}

class ResponseSink extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.bytes = 0;
    this.body = null;
  }
  status(code) { this.statusCode = code; return this; }
  set(name, value) {
    if (typeof name === 'object') Object.assign(this.headers, name);
    else this.headers[name] = value;
    return this;
  }
  json(body) { this.body = body; this.end(); return this; }
  sendStatus(code) { this.statusCode = code; this.end(); return this; }
  _write(buffer, encoding, callback) { this.bytes += buffer.length; callback(); }
}

function nextThrow(error) {
  if (error) throw error;
}

function makeMp3Frame() {
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return frame;
}

function writeReports() {
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2) + '\n', 'utf8');

  const blocks = Object.entries(results).map(([id, item]) => [
    id + ' (' + item.name + '):',
    '   - Input: ' + item.input,
    '   - Status: ' + item.status,
    '   - Result: ' + item.result,
    '   - Trạng thái: ' + item.test_status,
    ''
  ].join('\n'));

  fs.writeFileSync(textFile, blocks.join('\n'), 'utf8');
}

(async () => {
  await test(
    'TC01',
    'Tài khoản thường nghe bài FREE',
    "user=USER thường, songId=1, IsVIP=0, Range='bytes=0-15'",
    'Bài hát FREE phát bình thường.',
    async () => {
      const oldFind = Song.find;
      const oldIncrease = Song.increasePlays;
      try {
        Song.find = async () => ({
          MaBaiHat: 1,
          IsVIP: 0,
          TrangThai: 1,
          DuongDanAudio: 'demo-binh-minh.wav'
        });
        Song.increasePlays = async () => {};
        const res = new ResponseSink();
        const done = finished(res);
        await SongController.stream({
          params: { id: '1' },
          headers: { range: 'bytes=0-15' },
          user: { MaNguoiDung: 7, VaiTro: 'USER' },
          activeVIP: null
        }, res, nextThrow);
        await done;
        assert.equal(res.statusCode, 206);
        assert.equal(res.bytes, 16);
        assert.equal(res.headers['Content-Type'], 'audio/wav');
        return {
          status: 'HTTP 206 Partial Content',
          result: 'Server cấp audio FREE thành công; nhận 16 byte dữ liệu audio/wav.'
        };
      } finally {
        Song.find = oldFind;
        Song.increasePlays = oldIncrease;
      }
    }
  );

  await test(
    'TC02',
    'Tài khoản thường chọn bài VIP',
    'user=USER thường, songId=5, IsVIP=1, activeVIP=null',
    'Không cấp audio; yêu cầu đăng ký VIP.',
    async () => {
      const oldFind = Song.find;
      try {
        Song.find = async () => ({
          MaBaiHat: 5,
          IsVIP: 1,
          TrangThai: 1,
          DuongDanAudio: 'demo-vip-dem-sao.wav'
        });
        const res = makeRes();
        await SongController.stream({
          params: { id: '5' },
          headers: {},
          user: { MaNguoiDung: 7, VaiTro: 'USER' },
          activeVIP: null
        }, res, nextThrow);
        assert.equal(res.statusCode, 403);
        assert.match(res.body.error, /VIP/);
        return {
          status: 'HTTP 403 Forbidden',
          result: 'Server từ chối cấp audio và trả thông báo: "' + res.body.error + '"'
        };
      } finally {
        Song.find = oldFind;
      }
    }
  );

  await test(
    'TC03',
    'Tài khoản VIP còn hạn nghe bài VIP',
    "user=USER, songId=5, IsVIP=1, activeVIP=DA_XAC_NHAN, Range='bytes=0-15'",
    'Bài hát VIP phát thành công.',
    async () => {
      const oldFind = Song.find;
      const oldIncrease = Song.increasePlays;
      try {
        Song.find = async () => ({
          MaBaiHat: 5,
          IsVIP: 1,
          TrangThai: 1,
          DuongDanAudio: 'demo-vip-dem-sao.wav'
        });
        Song.increasePlays = async () => {};
        const res = new ResponseSink();
        const done = finished(res);
        await SongController.stream({
          params: { id: '5' },
          headers: { range: 'bytes=0-15' },
          user: { MaNguoiDung: 7, VaiTro: 'USER' },
          activeVIP: { MaDangKy: 20, TrangThai: 'DA_XAC_NHAN' }
        }, res, nextThrow);
        await done;
        assert.equal(res.statusCode, 206);
        assert.equal(res.bytes, 16);
        return {
          status: 'HTTP 206 Partial Content',
          result: 'Server xác nhận quyền VIP và stream bài VIP thành công.'
        };
      } finally {
        Song.find = oldFind;
        Song.increasePlays = oldIncrease;
      }
    }
  );

  await test(
    'TC04',
    'Thêm bài hát vào playlist thuộc tài khoản',
    'playlistId=3, userId=7, songId=9',
    'Bài được thêm đúng playlist.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [{ affectedRows: 1 }];
      };
      const changed = await Playlist.add(3, 7, 9);
      assert.equal(changed, 1);
      assert.match(captured.sql, /INSERT IGNORE INTO ChiTietPlaylist/);
      assert.match(captured.sql, /p\.MaNguoiDung=\?/);
      assert.deepEqual(captured.args, [9, 3, 7]);
      return {
        status: 'Database affectedRows=1',
        result: 'Tạo bản ghi ChiTietPlaylist cho playlistId=3 thuộc userId=7 và songId=9.'
      };
    }
  );

  await test(
    'TC05',
    'Thêm lại bài đã có trong cùng playlist',
    'playlistId=3, userId=7, songId=9 đã tồn tại',
    'Không tạo bản ghi trùng.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [{ affectedRows: 0 }];
      };
      const changed = await Playlist.add(3, 7, 9);
      assert.equal(changed, 0);
      assert.match(captured.sql, /INSERT IGNORE/);
      return {
        status: 'Database affectedRows=0',
        result: 'INSERT IGNORE không tạo thêm bản ghi khi bài hát đã tồn tại trong playlist.'
      };
    }
  );

  await test(
    'TC06',
    'Admin xác nhận yêu cầu VIP đang chờ',
    'registrationId=20, TrangThai=CHO_XAC_NHAN, ThoiHan=30 ngày, action=approve',
    'Đăng ký chuyển DA_XAC_NHAN và người dùng có quyền VIP.',
    async () => {
      const calls = [];
      let committed = false;
      const conn = {
        async beginTransaction() {},
        async rollback() {},
        async commit() { committed = true; },
        release() {},
        async execute(sql, args) {
          calls.push({ sql, args });
          if (/SELECT dv\.MaDangKy/.test(sql)) {
            return [[{ MaDangKy: 20, MaNguoiDung: 7, TrangThai: 'CHO_XAC_NHAN', ThoiHan: 30 }]];
          }
          if (/SELECT MaDangKy FROM DangKyVIP/.test(sql)) return [[]];
          if (/UPDATE DangKyVIP SET TrangThai='DA_XAC_NHAN'/.test(sql)) return [{ affectedRows: 1 }];
          if (/UPDATE NguoiDung SET TrangThaiVIP=1/.test(sql)) return [{ affectedRows: 1 }];
          throw new Error('SQL không mong đợi: ' + sql);
        }
      };
      fakeDb.getConnection = async () => conn;
      const ok = await VIP.decide(20, 'approve');
      assert.equal(ok, true);
      assert.equal(committed, true);
      assert.ok(calls.some(c => /TrangThai='DA_XAC_NHAN'/.test(c.sql)));
      assert.ok(calls.some(c => /TrangThaiVIP=1/.test(c.sql)));
      return {
        status: 'Database transaction COMMIT',
        result: 'DangKyVIP được cập nhật DA_XAC_NHAN, thiết lập thời hạn 30 ngày và TrangThaiVIP=1.'
      };
    }
  );

  await test(
    'TC07',
    'Admin upload audio/cover hợp lệ',
    'name=Auto Song, artistName=Auto Singer, genreId=1, audio=.mp3 hợp lệ, cover=.jpg hợp lệ',
    'Bài hát được lưu; ThoiLuong lấy từ audio.',
    async () => {
      const oldArtist = Song.findOrCreateArtist;
      const oldInsert = Song.insert;
      let inserted = null;
      try {
        Song.findOrCreateArtist = async () => 15;
        Song.insert = async song => { inserted = { ...song }; return 99; };
        const req = {
          body: { name: 'Auto Song', artistName: 'Auto Singer', genreId: '1', albumId: '', isVIP: '0' },
          files: {
            audioFile: [{ originalname: 'auto.mp3', mimetype: 'audio/mpeg', buffer: makeMp3Frame() }],
            coverFile: [{ originalname: 'cover.jpg', mimetype: 'image/jpeg', buffer: Buffer.from([0xff,0xd8,0xff,0x00]) }]
          },
          session: {}
        };
        const res = makeRes();
        await AdminController.create(req, res, nextThrow);
        assert.equal(res.statusCode, 302);
        assert.equal(res.redirectUrl, '/admin');
        assert.ok(inserted);
        assert.equal(inserted.duration, 1);
        assert.match(inserted.audio, /^upload-.*\.mp3$/);
        assert.match(inserted.cover, /^\/static\/uploads\/covers\/cover-.*\.jpg$/);
        return {
          status: 'HTTP 302 Found -> /admin',
          result: 'Lưu bài hát thành công; ThoiLuong=1 giây được đọc tự động từ audio; audio và cover hợp lệ.'
        };
      } finally {
        Song.findOrCreateArtist = oldArtist;
        Song.insert = oldInsert;
        if (inserted?.audio) {
          await fs.promises.unlink(path.join(root, 'storage', 'audio', inserted.audio)).catch(() => {});
        }
        if (inserted?.cover) {
          const file = path.basename(inserted.cover);
          await fs.promises.unlink(path.join(root, 'public', 'uploads', 'covers', file)).catch(() => {});
        }
      }
    }
  );

  await test(
    'TC08',
    'Admin upload audio sai định dạng',
    'audioFile=malware.exe, mimetype=application/octet-stream',
    'Hệ thống từ chối và thông báo lỗi.',
    async () => {
      const oldArtist = Song.findOrCreateArtist;
      const oldInsert = Song.insert;
      let inserted = false;
      try {
        Song.findOrCreateArtist = async () => 15;
        Song.insert = async () => { inserted = true; return 99; };
        const req = {
          body: { name: 'Invalid Song', artistName: 'Auto Singer', genreId: '1', albumId: '', isVIP: '0' },
          files: {
            audioFile: [{ originalname: 'malware.exe', mimetype: 'application/octet-stream', buffer: Buffer.from('invalid') }]
          },
          session: {}
        };
        const res = makeRes();
        await AdminController.create(req, res, nextThrow);
        assert.equal(res.statusCode, 302);
        assert.equal(res.redirectUrl, '/admin/songs/new');
        assert.equal(inserted, false);
        assert.equal(req.session.flash?.type, 'warning');
        assert.match(req.session.flash?.message || '', /mp3|aac/i);
        return {
          status: 'HTTP 302 Found -> /admin/songs/new',
          result: 'Hệ thống từ chối file sai định dạng và hiển thị: "' + req.session.flash.message + '"'
        };
      } finally {
        Song.findOrCreateArtist = oldArtist;
        Song.insert = oldInsert;
      }
    }
  );

  await test(
    'TC09',
    'Admin khóa/ẩn bài đang hoạt động',
    'songId=11, TrangThai=1',
    'TrangThai=0; bài không còn hiển thị cho User.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [{ affectedRows: 1 }];
      };
      const changed = await Song.remove(11);
      assert.equal(changed, 1);
      assert.match(captured.sql, /UPDATE BaiHat SET TrangThai=0/);
      assert.doesNotMatch(captured.sql, /DELETE FROM/i);
      return {
        status: 'Database affectedRows=1',
        result: 'Soft Delete thành công: TrangThai=0, dữ liệu bài hát vẫn được giữ trong CSDL.'
      };
    }
  );

  await test(
    'TC10',
    'Admin khôi phục bài hát đã ẩn',
    'songId=11, TrangThai=0',
    'TrangThai=1; bài hoạt động lại.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [{ affectedRows: 1 }];
      };
      const changed = await Song.restore(11);
      assert.equal(changed, 1);
      assert.match(captured.sql, /UPDATE BaiHat SET TrangThai=1/);
      return {
        status: 'Database affectedRows=1',
        result: 'Khôi phục thành công: TrangThai=1, bài hát được kích hoạt lại.'
      };
    }
  );

  await test(
    'TC11',
    'User chưa từng đăng ký VIP mở trang VIP',
    'userId=12, lịch sử DangKyVIP=không có',
    'Hiển thị gói Trải nghiệm FREE 1 ngày.',
    async () => {
      const trial = { MaGoi: 1, TenGoi: 'Trải nghiệm FREE 1 ngày', ThoiHan: 1, Gia: 0 };
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [[trial]];
      };
      const plans = await VIP.plans(12);
      assert.equal(plans.length, 1);
      assert.equal(plans[0].Gia, 0);
      assert.equal(plans[0].ThoiHan, 1);
      assert.match(captured.sql, /NOT EXISTS/);
      return {
        status: 'Query completed: 1 trial plan',
        result: 'VIP.plans(12) trả về gói "Trải nghiệm FREE 1 ngày".'
      };
    }
  );

  await test(
    'TC12',
    'User đã từng có DangKyVIP mở trang VIP',
    'userId=13, lịch sử DangKyVIP=đã tồn tại',
    'Không còn hiển thị gói FREE 1 ngày.',
    async () => {
      let captured = null;
      fakeDb.execute = async (sql, args) => {
        captured = { sql, args };
        return [[]];
      };
      const plans = await VIP.plans(13);
      assert.equal(plans.length, 0);
      assert.match(captured.sql, /NOT EXISTS/);
      assert.deepEqual(captured.args, [13]);
      return {
        status: 'Query completed: 0 trial plan',
        result: 'VIP.plans(13) không trả về gói FREE 1 ngày khi tài khoản đã có lịch sử DangKyVIP.'
      };
    }
  );

  await test(
    'TC13',
    'User nhận gói FREE 1 ngày',
    'userId=3, planId=1, Gia=0, ThoiHan=1, chưa từng có DangKyVIP',
    'Tạo DA_XAC_NHAN, thời hạn 1 ngày và có quyền VIP ngay.',
    async () => {
      const calls = [];
      let committed = false;
      const conn = {
        async beginTransaction() {},
        async rollback() {},
        async commit() { committed = true; },
        release() {},
        async execute(sql, args) {
          calls.push({ sql, args });
          if (/SELECT MaNguoiDung/.test(sql)) return [[{ MaNguoiDung: 3 }]];
          if (/SELECT \* FROM GoiVIP/.test(sql)) return [[{ MaGoi: 1, Gia: 0, ThoiHan: 1 }]];
          if (/SELECT MaDangKy FROM DangKyVIP/.test(sql)) return [[]];
          if (/INSERT INTO DangKyVIP/.test(sql)) return [{ affectedRows: 1 }];
          if (/UPDATE NguoiDung SET TrangThaiVIP=1/.test(sql)) return [{ affectedRows: 1 }];
          throw new Error('SQL không mong đợi: ' + sql);
        }
      };
      fakeDb.getConnection = async () => conn;
      const state = await VIP.claimTrial(3, 1);
      assert.equal(state, 'activated');
      assert.equal(committed, true);
      const insert = calls.find(c => /INSERT INTO DangKyVIP/.test(c.sql));
      assert.match(insert.sql, /DA_XAC_NHAN/);
      assert.match(insert.sql, /INTERVAL 1 DAY/);
      return {
        status: 'Database transaction COMMIT',
        result: 'Tạo DangKyVIP=DA_XAC_NHAN, NgayKetThuc=NOW()+1 DAY và TrangThaiVIP=1.'
      };
    }
  );

  await test(
    'TC14',
    'User chọn VIP trả phí và xác nhận thanh toán mô phỏng',
    'userId=7, planId=2, Gia=49000, ThoiHan=30, paymentMethod=BANK_TRANSFER',
    'Tạo yêu cầu CHO_XAC_NHAN.',
    async () => {
      const calls = [];
      let committed = false;
      const conn = {
        async beginTransaction() {},
        async rollback() {},
        async commit() { committed = true; },
        release() {},
        async execute(sql, args) {
          calls.push({ sql, args });
          if (/SELECT MaNguoiDung/.test(sql)) return [[{ MaNguoiDung: 7 }]];
          if (/SELECT \* FROM GoiVIP/.test(sql)) return [[{ MaGoi: 2, TenGoi: 'VIP 30 ngày', Gia: 49000, ThoiHan: 30 }]];
          if (/SELECT MaDangKy FROM DangKyVIP/.test(sql)) return [[]];
          if (/INSERT INTO DangKyVIP/.test(sql)) return [{ affectedRows: 1 }];
          throw new Error('SQL không mong đợi: ' + sql);
        }
      };
      fakeDb.getConnection = async () => conn;
      const state = await VIP.request(7, 2);
      assert.equal(state, 'created');
      assert.equal(committed, true);
      const insert = calls.find(c => /INSERT INTO DangKyVIP/.test(c.sql));
      assert.match(insert.sql, /CHO_XAC_NHAN/);
      assert.deepEqual(insert.args, [7, 2, 30]);
      return {
        status: 'Database transaction COMMIT',
        result: 'Sau xác nhận thanh toán mô phỏng, tạo DangKyVIP trạng thái CHO_XAC_NHAN cho gói 30 ngày.'
      };
    }
  );

  await test(
    'TC15',
    'Admin khóa USER và nhập lý do hợp lệ',
    "userId=7, reason='Vi phạm quy định', email=locked@wave.local, password=12345678",
    'TrangThai=0, lưu LyDoKhoa; user bị từ chối đăng nhập.',
    async () => {
      let updateCall = null;
      fakeDb.execute = async (sql, args) => {
        updateCall = { sql, args };
        return [{ affectedRows: 1 }];
      };
      const changed = await User.lock(7, 'Vi phạm quy định');
      assert.equal(changed, 1);
      assert.match(updateCall.sql, /TrangThai=0/);
      assert.deepEqual(updateCall.args, ['Vi phạm quy định', 7]);

      const oldFind = User.findByEmail;
      try {
        const hash = await bcrypt.hash('12345678', 4);
        User.findByEmail = async () => ({
          MaNguoiDung: 7,
          HoTen: 'Locked User',
          Email: 'locked@wave.local',
          MatKhau: hash,
          VaiTro: 'USER',
          TrangThai: 0,
          LyDoKhoa: 'Vi phạm quy định'
        });
        const req = { body: { email: 'locked@wave.local', password: '12345678' }, session: {} };
        const res = makeRes();
        await AuthController.login(req, res, nextThrow);
        assert.equal(res.statusCode, 302);
        assert.equal(res.redirectUrl, '/login');
        assert.match(req.session.flash?.message || '', /Tài khoản đã bị khóa/);
        assert.match(req.session.flash?.message || '', /Vi phạm quy định/);
        return {
          status: 'HTTP 302 Found -> /login',
          result: 'TrangThai=0, LyDoKhoa được lưu; đăng nhập bị từ chối với lý do khóa.'
        };
      } finally {
        User.findByEmail = oldFind;
      }
    }
  );

  await test(
    'TC16',
    'Admin mở khóa USER',
    'userId=7, email=unlocked@wave.local, password=12345678',
    'TrangThai=1, LyDoKhoa=NULL; user đăng nhập lại được.',
    async () => {
      let updateCall = null;
      fakeDb.execute = async (sql, args) => {
        updateCall = { sql, args };
        return [{ affectedRows: 1 }];
      };
      const changed = await User.unlock(7);
      assert.equal(changed, 1);
      assert.match(updateCall.sql, /TrangThai=1/);
      assert.match(updateCall.sql, /LyDoKhoa=NULL/);

      const oldFind = User.findByEmail;
      try {
        const hash = await bcrypt.hash('12345678', 4);
        User.findByEmail = async () => ({
          MaNguoiDung: 7,
          HoTen: 'Unlocked User',
          Email: 'unlocked@wave.local',
          MatKhau: hash,
          VaiTro: 'USER',
          TrangThai: 1,
          LyDoKhoa: null
        });
        const session = {
          regenerate(cb) { cb(); },
          save(cb) { cb(); }
        };
        const req = { body: { email: 'unlocked@wave.local', password: '12345678' }, session };
        const res = makeRes();
        await AuthController.login(req, res, nextThrow);
        assert.equal(res.statusCode, 302);
        assert.equal(res.redirectUrl, '/');
        assert.equal(req.session.userId, 7);
        return {
          status: 'HTTP 302 Found -> /',
          result: 'TrangThai=1, LyDoKhoa=NULL; đăng nhập thành công và session userId=7 được tạo lại.'
        };
      } finally {
        User.findByEmail = oldFind;
      }
    }
  );

  writeReports();

  const values = Object.values(results);
  const passed = values.filter(r => r.test_status === 'PASS').length;
  const failed = values.length - passed;

  console.log('');
  console.log('RESULT: ' + passed + '/' + values.length + ' test case PASS');
  console.log('TXT: ' + path.relative(root, textFile));
  console.log('JSON: ' + path.relative(root, summaryFile));

  if (failed) {
    console.error('RESULT: ' + failed + ' test case FAIL');
    process.exitCode = 1;
  }
})().catch(error => {
  results.FATAL = {
    name: 'Lỗi chạy bộ test',
    input: 'N/A',
    expected: 'Bộ test chạy hoàn tất.',
    status: 'ERROR',
    result: error.message,
    test_status: 'FAIL'
  };
  writeReports();
  console.error(error);
  process.exitCode = 1;
});

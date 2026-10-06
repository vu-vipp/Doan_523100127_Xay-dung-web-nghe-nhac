const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const target = path.join(__dirname, '..', '.env');
if (fs.existsSync(target)) {
  console.log('.env đã tồn tại; không ghi đè cấu hình của bạn.');
} else {
  const source = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  fs.writeFileSync(target, source.replace('CHANGE_ME_TO_A_RANDOM_32_PLUS_CHARACTER_SECRET', crypto.randomBytes(32).toString('hex')), { mode: 0o600 });
  console.log('Đã tạo .env với SESSION_SECRET ngẫu nhiên. Kiểm tra DB_USER / DB_PASSWORD / DB_NAME.');
}
